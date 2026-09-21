/**
 * What the run does NEXT — the one decision the run loop makes between steps
 * (PLAN §9.1 "Steps, not loops", §9.2 "Initial batch").
 *
 * Every read here is an exact index range with a stated bound, because this
 * runs before every single step: the agent's enabled strategies, the leads it
 * has already researched, the leads still waiting, and the two money facts
 * that decide whether a paid step may start at all.
 *
 * The order is sourcing first, then research: a run with nothing found yet
 * has nothing worth researching, and PLAN §9.2 starts with page 1 of every
 * selected signal.
 *
 * Nothing here writes, spends or schedules. It answers one question.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { bucketRemaining, dailyPeriodKey, findBucket, findCreditsBucket } from "../billing/model";
import { paidCallsPaused } from "../billing/platformBudgets";
import { MAX_SEARCH_PAGE, SEARCH_PAGE_SIZE } from "../integrations/enrich/search";
import { ACTION_PRICES } from "../lib/limits";
import { LEAD_SCORE_MIN } from "../lib/validators";

/* ------------------------------------------------------------------ */
/* Bounds and batch sizes                                              */
/*                                                                     */
/* These belong in `convex/lib/limits.ts` with every other number the  */
/* product spends against; they are local constants only because that  */
/* file is integrator-only (EXECUTION §0).                             */
/* ------------------------------------------------------------------ */

/** PLAN §9.2 step 3: "the top 8 overall … minimum 1 per strategy, maximum 10".
 *  The floor is 8; an agent with more signals than that researches one per
 *  signal, and ten is the ceiling whatever the signal count. */
export const INITIAL_RESEARCH_BATCH = 8;

export const INITIAL_RESEARCH_MAX = 10;

/** An agent's strategies are a handful by construction (PLAN §3: 3–5 plus a
 *  keyword one); the bound is a guard, not a page size. */
const STRATEGY_SCAN_MAX = 25;

/** How many waiting leads one selection looks at. The best of the newest
 *  rows, not the best of every row ever found — a bounded read per step. */
const RESEARCH_CANDIDATE_SCAN = 200;

/** How far back the per-signal round-robin counts. */
const RESEARCH_HISTORY_SCAN = 100;

/** How many approved leads the email reserve is measured over. */
const APPROVED_SCAN_MAX = 100;

/* ------------------------------------------------------------------ */
/* The answer                                                          */
/* ------------------------------------------------------------------ */

/**
 * Why a run has nothing to do. Every member is a fact an operator can act on
 * — none of them names a provider, and none is an error.
 */
export type RunIdleReason =
  | "not_live"
  | "paused"
  | "platform_paused"
  | "no_strategies"
  | "signals_parked"
  | "daily_lead_cap"
  | "pages_exhausted"
  | "research_budget_spent"
  | "no_research_candidates"
  | "out_of_credits";

export type RunStep =
  | { kind: "source"; strategyId: Id<"strategies">; page: number }
  | { kind: "research"; prospectId: Id<"prospects"> }
  | { kind: "idle"; reason: RunIdleReason };

/**
 * The next step this agent should take, or why it should stop.
 *
 * The kill switch and the agent's own mode are checked FIRST, so a paused
 * agent and a paused platform start nothing new — an in-flight step still
 * finishes and writes its result, which is the other half of PLAN §9.1's
 * invalidation table.
 */
export async function planNextStep(
  ctx: QueryCtx,
  agent: Doc<"agents">,
): Promise<RunStep> {
  if (agent.status !== "live") {
    return { kind: "idle", reason: "not_live" };
  }
  if (agent.mode === "paused") {
    return { kind: "idle", reason: "paused" };
  }
  if (paidCallsPaused()) {
    return { kind: "idle", reason: "platform_paused" };
  }

  const org = await ctx.db.get("orgs", agent.orgId);
  if (org === null) {
    return { kind: "idle", reason: "not_live" };
  }
  const creditsBucket = await findCreditsBucket(ctx, agent.orgId);
  const credits = creditsBucket === null ? 0 : bucketRemaining(creditsBucket);

  const enabled = await ctx.db
    .query("strategies")
    .withIndex("by_agentId_and_enabled", (q) =>
      q.eq("agentId", agent._id).eq("enabled", true),
    )
    .take(STRATEGY_SCAN_MAX);
  if (enabled.length === 0) {
    return { kind: "idle", reason: "no_strategies" };
  }
  // A signal a search refused is out of the rotation until a person switches
  // it off and on again (`agents/sourcing.ts#parkStrategy`). It stays
  // `enabled`, because that field is the user's answer and not the run's.
  const strategies = enabled.filter(
    (strategy) => strategy.lastError === undefined,
  );
  if (strategies.length === 0) {
    return { kind: "idle", reason: "signals_parked" };
  }

  const sourcing = await nextStrategyPage(ctx, {
    agent,
    org,
    strategies,
    credits,
  });
  if (sourcing.kind !== "idle") {
    return sourcing;
  }

  const research = await nextResearchLead(ctx, {
    agent,
    org,
    enabledStrategies: strategies.length,
    credits,
  });
  if (research.kind !== "idle") {
    return research;
  }
  // Sourcing's reason is the more useful one while pages remain; research's
  // is what an operator needs once the pages are gone.
  return sourcing.reason === "pages_exhausted" ? research : sourcing;
}

/* ------------------------------------------------------------------ */
/* Sourcing                                                            */
/* ------------------------------------------------------------------ */

/**
 * The next page to buy, if any.
 *
 * ONE allowance governs every page, first or not: `dailyLeadCap` in whole
 * pages, plus one page for each selected signal that has never been searched.
 * That second term is PLAN §9.2 step 1 — "search page 1 of each selected
 * strategy" — expressed as budget rather than as an exemption: setup day
 * buys exactly one page per signal and then stops, where a plain exemption
 * let five or six signals buy five or six pages against a cap of one and
 * called it compliance. A signal switched on later still gets its first page
 * the day it is switched on, which is what makes the per-signal table honest.
 *
 * "How many pages today" is read from the usage ledger's own daily search
 * counter rather than from a count of rows: the ledger is already keyed on
 * the org's local day, and it is the counter the money layer enforces,
 * so the two can never disagree.
 */
async function nextStrategyPage(
  ctx: QueryCtx,
  args: {
    agent: Doc<"agents">;
    org: Doc<"orgs">;
    strategies: Doc<"strategies">[];
    credits: number;
  },
): Promise<RunStep> {
  const firstPages = args.strategies.filter(
    (strategy) => pageOf(strategy) === 1,
  );
  const fresh = [...firstPages].sort((a, b) => a.createdAt - b.createdAt)[0];
  const continued = args.strategies
    .filter(
      (strategy) => pageOf(strategy) > 1 && pageOf(strategy) <= MAX_SEARCH_PAGE,
    )
    .sort((a, b) => pageOf(a) - pageOf(b) || a.createdAt - b.createdAt)[0];

  if (fresh === undefined && continued === undefined) {
    return { kind: "idle", reason: "pages_exhausted" };
  }
  if (args.credits < ACTION_PRICES.find_leads.credits) {
    return { kind: "idle", reason: "out_of_credits" };
  }

  const pagesPerDay =
    Math.max(1, Math.ceil(args.agent.dailyLeadCap / SEARCH_PAGE_SIZE)) +
    firstPages.length;
  const bucket = await findBucket(
    ctx,
    args.org._id,
    "enrich_searches",
    dailyPeriodKey(args.org, Date.now()),
  );
  const usedToday =
    bucket === null ? 0 : bucket.reserved + bucket.committed + bucket.uncertain;
  if (usedToday >= pagesPerDay) {
    return { kind: "idle", reason: "daily_lead_cap" };
  }
  if (fresh !== undefined) {
    return { kind: "source", strategyId: fresh._id, page: 1 };
  }
  if (continued === undefined) {
    return { kind: "idle", reason: "pages_exhausted" };
  }
  return { kind: "source", strategyId: continued._id, page: pageOf(continued) };
}

/** The page a strategy is due to buy next; a stored 0 means "page 1". */
function pageOf(strategy: Doc<"strategies">): number {
  return Math.max(1, Math.trunc(strategy.nextPage));
}

/* ------------------------------------------------------------------ */
/* Research                                                            */
/* ------------------------------------------------------------------ */

/**
 * The next lead to research, if the budget and the credits allow one.
 *
 * Two budgets, in PLAN §9.2's order:
 *   the INITIAL batch — the first ~8 leads across the whole agent, so the
 *   user lands on Contacts with real scored rows;
 *   then `dailyResearchCap` a day, counted from the day's page allowance in
 *   the usage ledger (the same day key the money layer uses).
 *
 * And one money rule on top of both: research may only spend what is left
 * after reserving the address of every lead the user has already approved
 * (PLAN §9.2 step 5). Approving a lead is a promise that costs 15 credits;
 * research must not eat it.
 *
 * The choice among candidates is round-robin across signals — the candidate
 * whose least-researched signal has the fewest researched leads wins, best
 * `preRank` breaking the tie — which is what "minimum 1 per strategy" means
 * when the leads arrive one page at a time.
 */
async function nextResearchLead(
  ctx: QueryCtx,
  args: {
    agent: Doc<"agents">;
    org: Doc<"orgs">;
    enabledStrategies: number;
    credits: number;
  },
): Promise<RunStep> {
  const researched = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_scoreKey", (q) =>
      q.eq("orgId", args.org._id).gte("scoreKey", LEAD_SCORE_MIN),
    )
    .take(RESEARCH_HISTORY_SCAN);

  const initialTarget = Math.min(
    INITIAL_RESEARCH_MAX,
    Math.max(INITIAL_RESEARCH_BATCH, args.enabledStrategies),
  );
  let remaining: number;
  if (researched.length < initialTarget) {
    remaining = initialTarget - researched.length;
  } else {
    // The agent's OWN day counter (`agents.researchDay`), not the day-keyed
    // page allowance: that allowance also carries the owner's website
    // re-analysis, so a re-analyse day quietly spent the agent's research
    // budget on a scrape that researched no lead at all. The page allowance
    // is still the money layer's cap; this is the product rule on top of it.
    const periodKey = dailyPeriodKey(args.org, Date.now());
    const researchedToday =
      args.agent.researchDay?.periodKey === periodKey
        ? args.agent.researchDay.count
        : 0;
    remaining = args.agent.dailyResearchCap - researchedToday;
  }
  if (remaining <= 0) {
    return { kind: "idle", reason: "research_budget_spent" };
  }

  const reserved =
    ACTION_PRICES.get_email.credits *
    (await countApprovedAwaitingEmail(ctx, args.org._id));
  if (args.credits - reserved < ACTION_PRICES.research_lead.credits) {
    return { kind: "idle", reason: "out_of_credits" };
  }

  const now = Date.now();
  const candidates = (
    await ctx.db
      .query("prospects")
      .withIndex("by_agentId_and_stage", (q) =>
        q.eq("agentId", args.agent._id).eq("stage", "found"),
      )
      .take(RESEARCH_CANDIDATE_SCAN)
  ).filter(
    (lead) =>
      lead.approval !== "rejected" &&
      lead.research.status !== "researched" &&
      lead.research.status !== "researching" &&
      (lead.nextActionAt === undefined || lead.nextActionAt <= now),
  );
  if (candidates.length === 0) {
    return { kind: "idle", reason: "no_research_candidates" };
  }

  const perStrategy = new Map<string, number>();
  for (const lead of researched) {
    if (lead.origin.kind !== "sourced") {
      continue;
    }
    for (const strategyId of lead.origin.strategyIds) {
      perStrategy.set(strategyId, (perStrategy.get(strategyId) ?? 0) + 1);
    }
  }

  let best = candidates[0];
  let bestDebt = signalDebt(best, perStrategy);
  for (const candidate of candidates.slice(1)) {
    const debt = signalDebt(candidate, perStrategy);
    if (
      debt < bestDebt ||
      (debt === bestDebt &&
        (candidate.preRank > best.preRank ||
          (candidate.preRank === best.preRank &&
            candidate.createdAt < best.createdAt)))
    ) {
      best = candidate;
      bestDebt = debt;
    }
  }
  return { kind: "research", prospectId: best._id };
}

/**
 * How well this lead's signals are already represented: the FEWEST researched
 * leads any of its signals has. A person found by a signal nothing has been
 * researched for scores 0 and goes first, which is the "minimum 1 per
 * strategy" rule expressed as an ordering rather than a quota.
 */
function signalDebt(
  lead: Doc<"prospects">,
  perStrategy: Map<string, number>,
): number {
  if (lead.origin.kind !== "sourced" || lead.origin.strategyIds.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.min(
    ...lead.origin.strategyIds.map((id) => perStrategy.get(id) ?? 0),
  );
}

/** Leads the user said yes to that still have no address — the credits the
 *  agent has already promised to spend (PLAN §9.2 step 5). */
async function countApprovedAwaitingEmail(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<number> {
  const approved = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_approval", (q) =>
      q.eq("orgId", orgId).eq("approval", "approved"),
    )
    .take(APPROVED_SCAN_MAX);
  return approved.filter(
    (lead) => lead.emailStatus === "locked" || lead.emailStatus === "revealing",
  ).length;
}
