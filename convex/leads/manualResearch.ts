/**
 * "Research this one" — the Contacts button behind PLAN §9.2 step 4: the
 * leads the agent's initial batch did not reach stay `found` with a Research
 * action (3 credits) per row and in bulk, and a lead the retry ladder parked
 * gets the same action as its Retry.
 *
 * The agent's own research step (`leads/research.ts`) runs INSIDE a run lease
 * and hands the lease back to the planner between steps, so it cannot be
 * called for a lead the user picked. This is the same work without the lease:
 * the page is bought under the SAME operation key the agent uses, so a lead
 * whose page the agent already paid for is never scraped twice, and the
 * result is written through `leads/researchState.ts` — still the only writer
 * of `prospects.research`.
 *
 * The model call is keyed on the claim instant instead of an attempt number.
 * A completed generation is billed whatever it answered (PLAN §6), so every
 * new attempt has to be a new key rather than a replay of a settled one.
 *
 * BOTH LAYERS ARE CHECKED HERE, like the reveal path: the kill switch, the
 * visible credit balance, the hidden per-org page allowance and the
 * platform's own budget (PLAN §6 "A call must pass both layers"). Checking
 * only the credits left the refusal to the reserve inside the action, where
 * all the user saw was the row flipping from "Researching" back to "Not
 * researched" with no reason and no lead event.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { bucketRemaining, dailyPeriodKey, findBucket } from "../billing/model";
import {
  paidCallsPaused,
  platformBudgetHasRoom,
} from "../billing/platformBudgets";
import { requireOrgMember } from "../lib/auth";
import { ACTION_PRICES, TRIAL_METRIC_CAPS } from "../lib/limits";
import { requireRateLimit } from "../lib/rateLimits";
import {
  domainError,
  invalid,
  leadScoreKey,
  USAGE_PERIOD_LIFETIME,
} from "../lib/validators";
import type { LeadResearch } from "../lib/validators";
import { LEAD_RETRY_REASON, loadProspectForWrite, unparkLead } from "./model";
import { RESEARCH_STALL_MS } from "./researchState";
import { v } from "convex/values";

/** Leads one manual request may start. Research is three credits each, and
 *  the page allowance is a day-keyed cap — a selection of ten is already more
 *  than a trial day's worth. */
const MANUAL_RESEARCH_MAX = 10;

/** One page per lead, the same page `leads/research.ts` buys. */
const RESEARCH_PAGES_PER_LEAD = 1;

const vSkipReason = v.union(
  v.literal("already_researched"),
  v.literal("in_flight"),
  v.literal("rejected"),
  v.literal("credits"),
  /** The hidden per-org page allowance, or the platform's own budget, has no
   *  room for this lead's page (PLAN §6 layer 2). */
  v.literal("provider_limit"),
);

/**
 * Research one lead, or a selection — and un-park a lead the ladder gave up
 * on, which is what the Retry button on a `needs_attention` lead is.
 *
 * Nothing is bought here: the mutation authorises, claims the leads it can
 * pay for and schedules the internal action that spends (PLAN §6).
 */
export const researchNow = mutation({
  args: {
    orgId: v.id("orgs"),
    prospectIds: v.array(v.id("prospects")),
  },
  returns: v.object({
    started: v.number(),
    /** Parked leads put back in the queue instead — free (PLAN §6). */
    unparked: v.number(),
    creditsPerLead: v.number(),
    skipped: v.array(
      v.object({ prospectId: v.id("prospects"), reason: vSkipReason }),
    ),
  }),
  handler: async (ctx, args) => {
    const { identityKey, org } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    await requireRateLimit(ctx, "researchLead", identityKey);
    if (args.prospectIds.length === 0) {
      throw invalid("prospectIds must name at least one lead");
    }
    if (args.prospectIds.length > MANUAL_RESEARCH_MAX) {
      throw invalid(
        `at most ${MANUAL_RESEARCH_MAX} leads can be researched at once`,
      );
    }
    // The kill switch answers before anything else, exactly as it does inside
    // the credit wrapper: nothing paid starts while the platform is paused.
    if (paidCallsPaused()) {
      throw domainError(
        "PLATFORM_PAUSED",
        "paid work is paused right now; nothing can be researched",
      );
    }
    const price = ACTION_PRICES.research_lead.credits;
    const credits = await findBucket(
      ctx,
      org._id,
      "credits",
      USAGE_PERIOD_LIFETIME,
    );
    if (credits === null) {
      throw domainError(
        "NO_CREDIT_GRANT",
        "this organization has no credit grant; no paid step can run",
      );
    }
    const affordable = Math.floor(bucketRemaining(credits) / price);
    if (affordable === 0) {
      throw domainError(
        "INSUFFICIENT_CREDITS",
        "not enough credits to research a lead",
      );
    }
    // Layer 2, the actual guarantee (PLAN §6): the hidden page allowance this
    // org still has, and the platform's own budget for the period. Checked
    // HERE so the refusal is immediate and says which layer refused, instead
    // of a reserve failing inside the action and the row flipping back to
    // "Not researched" with nothing to read.
    let pages = await scrapeAllowance(ctx, org);

    const now = Date.now();
    let started = 0;
    let unparked = 0;
    const skipped: {
      prospectId: Id<"prospects">;
      reason: typeof vSkipReason.type;
    }[] = [];
    for (const prospectId of new Set(args.prospectIds)) {
      const lead = await loadProspectForWrite(ctx, args.orgId, prospectId);
      if (lead.approval === "rejected") {
        skipped.push({ prospectId, reason: "rejected" });
        continue;
      }
      if (lead.research.status === "researched") {
        // Retry on a lead that HAS a score is not research — there is nothing
        // to buy. It is the un-park, and the un-park is free (PLAN §6), so
        // this button and the agent page's Retry now cost the same thing.
        if (lead.stage === "needs_attention") {
          await unparkLead(ctx, lead, {
            reason: LEAD_RETRY_REASON,
            now,
            identityKey,
          });
          unparked += 1;
          continue;
        }
        skipped.push({ prospectId, reason: "already_researched" });
        continue;
      }
      if (lead.research.status === "researching") {
        skipped.push({ prospectId, reason: "in_flight" });
        continue;
      }
      if (started >= affordable) {
        skipped.push({ prospectId, reason: "credits" });
        continue;
      }
      // Only a lead with a company site spends a page; one without is scored
      // from its preview alone, so the page allowance has no say over it.
      const needsPage = lead.canonicalDomain !== undefined;
      if (needsPage && pages < RESEARCH_PAGES_PER_LEAD) {
        skipped.push({ prospectId, reason: "provider_limit" });
        continue;
      }
      if (needsPage) {
        pages -= RESEARCH_PAGES_PER_LEAD;
      }
      await claim(ctx, lead, now);
      await ctx.scheduler.runAfter(
        0,
        internal.leads.manualResearchRun.runManualResearch,
        {
          orgId: args.orgId,
          prospectId,
          claimedAt: now,
        },
      );
      started += 1;
    }
    if (started === 0 && unparked === 0 && skipped.length > 0) {
      const refusal = skipped.find((skip) => skip.reason === "provider_limit");
      if (refusal !== undefined) {
        throw await pageRefusal(ctx);
      }
    }
    return { started, unparked, creditsPerLead: price, skipped };
  },
});

/**
 * Pages this org may still fetch: the hidden lifetime and daily caps, and
 * the platform's own budget for the period, whichever is smallest.
 *
 * A period with no bucket yet is not "unlimited" — the reserve would create
 * it from the trial cap, so the cap is what this org can spend today.
 */
async function scrapeAllowance(
  ctx: MutationCtx,
  org: Doc<"orgs">,
): Promise<number> {
  const now = Date.now();
  const lifetime = await findBucket(ctx, org._id, "scrapes", USAGE_PERIOD_LIFETIME);
  const daily = await findBucket(
    ctx,
    org._id,
    "scrapes",
    dailyPeriodKey(org, now),
  );
  const byOrg = Math.min(
    lifetime === null
      ? TRIAL_METRIC_CAPS.scrapes.lifetime
      : bucketRemaining(lifetime),
    daily === null ? TRIAL_METRIC_CAPS.scrapes.daily : bucketRemaining(daily),
  );
  if (byOrg <= 0) {
    return 0;
  }
  return (await platformBudgetHasRoom(ctx, "scrapes", RESEARCH_PAGES_PER_LEAD, now))
    ? byOrg
    : 0;
}

/**
 * WHICH layer refused the page. PLAN §6: an org's own trial limit and
 * "the platform is at capacity today" are different sentences, and the code
 * is what the client maps to copy.
 */
async function pageRefusal(ctx: MutationCtx) {
  const now = Date.now();
  const room = await platformBudgetHasRoom(
    ctx,
    "scrapes",
    RESEARCH_PAGES_PER_LEAD,
    now,
  );
  return room
    ? domainError(
        "TRIAL_LIMIT_REACHED",
        "this organization's research allowance for the trial is used up",
      )
    : domainError(
        "PLATFORM_CAPACITY",
        "the platform is at capacity for this period; no lead can be researched now",
      );
}

/**
 * Claim the lead for this step, and un-park it if the ladder had given up.
 *
 * Clearing `lastError` and leaving `needs_attention` is deliberate and only
 * ever happens HERE: an automatic transition may not un-park a lead
 * (`advancedLeadStage`), which is what makes the Retry button honest.
 */
async function claim(
  ctx: MutationCtx,
  lead: Doc<"prospects">,
  now: number,
): Promise<void> {
  const research: LeadResearch = { status: "researching", startedAt: now };
  await ctx.db.patch("prospects", lead._id, {
    research,
    // Written in the same patch as `research`, never alone (PLAN §7).
    scoreKey: leadScoreKey(research),
    nextActionAt: now + RESEARCH_STALL_MS,
    lastError: undefined,
    // A person asking again restarts every step's ladder, exactly as the
    // agent page's Retry does.
    stepAttempts: undefined,
    updatedAt: now,
    ...(lead.stage === "needs_attention"
      ? { stage: "found" as const, stageReason: LEAD_RETRY_REASON }
      : {}),
  });
}
