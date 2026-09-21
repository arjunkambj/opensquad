/**
 * Automatic email reveal — the outreach loop's step (b), and the one place
 * the agent buys an address without a person pressing a button
 * (PLAN §9.3, EXECUTION T40 "Automatic email reveal lives here").
 *
 * It does NOT reimplement the reveal. `leads/emailReveal.ts#requestEmails` is
 * the MANUAL door: it authenticates a user, rate-limits them and applies the
 * bulk score guard. Underneath it, the claim → `submitReveals` → poll →
 * `applyRevealedEmail` pipeline is shared, and this file enters it at exactly
 * the same point with exactly the same per-prospect operation key. That key is
 * what makes "a lead is never bought twice" true across both doors: a lead
 * whose address the user already paid for replays the recorded outcome
 * instead of buying it again.
 *
 * WHO GETS ONE, by mode (PLAN §9.3):
 *   Review    — automatically, once the lead is approved. The approval IS the
 *               authorisation for the 15 credits, so there is no extra cap
 *               beyond the balance and the hidden provider allowance.
 *   Autopilot — automatically, at most `autoRevealDailyCap` an org-local
 *               day. `autoRevealRemainingToday` below says exactly what that
 *               counts.
 *   Sourcing only / Paused — never: the tick refuses before reaching here.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import {
  bucketRemaining,
  dailyPeriodKey,
  findBucket,
  findCreditsBucket,
} from "../billing/model";
import { REVEAL_CREDITS_PER_LEAD } from "../integrations/enrich/reveal";
import { REVEAL_STALL_MS } from "../leads/emailRevealState";
import { ACTION_PRICES } from "../lib/limits";
import { boundedInt } from "../lib/validators";
import { agentRunsOutreach } from "./outreachPlan";
import { v } from "convex/values";

/** Leads one selection pass reads. */
const CANDIDATE_SCAN_MAX = 100;

/**
 * PLAN §12's spend guard, and the same threshold `leads/emailReveal.ts`
 * applies to a bulk request: an address costs 15 credits, so the agent only
 * ever buys one for a lead research rated 2 or 3. A person asking for ONE
 * lead by hand is still allowed any score — that is the row button, and it is
 * an explicit human decision about that lead.
 */
const AUTO_REVEAL_MIN_SCORE = 2;

/** Addresses one pass may start. Small on purpose: this is the expensive
 *  step, and the tick comes round every minute. */
const REVEALS_PER_PASS_MAX = 5;

/**
 * Claim the approved leads whose address the agent should buy, and hand them
 * to the shared reveal pipeline.
 *
 * Nothing is bought inside this mutation: it claims, then schedules the
 * internal action that spends (PLAN §6 "paid work only happens in an
 * `internalAction` an authenticated mutation scheduled" — here the cron's
 * mutation stands in for the user's, and the authorisation it carries is the
 * lead approval plus, in Autopilot, the recorded consent).
 */
export const claimAutoReveals = internalMutation({
  args: {
    agentId: v.id("agents"),
    limit: v.optional(v.number()),
  },
  returns: v.object({ started: v.number() }),
  handler: async (ctx, args): Promise<{ started: number }> => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { started: 0 };
    }
    const org = await ctx.db.get("orgs", agent.orgId);
    if (org === null || !agentRunsOutreach(org, agent)) {
      return { started: 0 };
    }
    const limit =
      args.limit === undefined
        ? REVEALS_PER_PASS_MAX
        : boundedInt(args.limit, "limit", { min: 1, max: REVEALS_PER_PASS_MAX });
    const allowance = Math.min(
      limit,
      await autoRevealRemainingToday(ctx, org, agent),
    );
    if (allowance <= 0) {
      return { started: 0 };
    }
    // Both money layers, checked before a claim rather than after: a lead
    // claimed for a call the reserve then refuses would bounce back to
    // `locked` a round trip later, for nothing.
    if (!(await canAffordOneReveal(ctx, org))) {
      return { started: 0 };
    }

    const targets = await selectRevealTargets(ctx, agent, allowance);
    const claimed: Id<"prospects">[] = [];
    const now = Date.now();
    for (const prospectId of targets) {
      const lead = await ctx.db.get("prospects", prospectId);
      if (lead === null || lead.emailStatus !== "locked") {
        continue;
      }
      await ctx.db.patch("prospects", prospectId, {
        emailStatus: "revealing",
        // The claim is also its watchdog, exactly as the manual door sets it:
        // a step that dies mid-flight shows up as an overdue lead that the
        // recovery sweep re-drives, not as a row nobody looks at again.
        nextActionAt: now + REVEAL_STALL_MS,
        updatedAt: now,
      });
      claimed.push(prospectId);
    }
    if (claimed.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.leads.emailRevealRun.submitReveals,
        { orgId: org._id, prospectIds: claimed },
      );
    }
    return { started: claimed.length };
  },
});

/**
 * How many addresses Autopilot may still find today.
 *
 * WHAT IS COUNTED, exactly: every email the ORG has found in its own
 * local day, read from the usage ledger's `enrich_credits` day bucket
 * (reserved + committed + uncertain, divided by the ten provider units one
 * reveal costs). That bucket is the counter the money layer itself enforces,
 * so the cap can never disagree with what was actually spent — and it
 * includes addresses a PERSON asked for by hand. Sharing the counter can only
 * make the agent reveal fewer, never more, which is the conservative
 * direction for a spend cap, and it is the same trade `agents/runPlan.ts`
 * makes for the daily research cap.
 *
 * Review is deliberately uncapped here: in that mode a person approved each
 * lead one by one, and PLAN §9.3 makes lead approval itself the authorisation
 * for the 15 credits. The credit balance and the hidden provider caps are
 * still the real ceiling in both modes.
 */
async function autoRevealRemainingToday(
  ctx: QueryCtx,
  org: Doc<"orgs">,
  agent: Doc<"agents">,
): Promise<number> {
  if (agent.mode !== "autopilot") {
    return Number.MAX_SAFE_INTEGER;
  }
  const bucket = await findBucket(
    ctx,
    org._id,
    "enrich_credits",
    dailyPeriodKey(org, Date.now()),
  );
  const usedUnits =
    bucket === null ? 0 : bucket.reserved + bucket.committed + bucket.uncertain;
  const revealedToday = Math.ceil(usedUnits / REVEAL_CREDITS_PER_LEAD);
  return Math.max(0, agent.autoRevealDailyCap - revealedToday);
}

/** Can the org still pay for one address at all (PLAN §6, both layers)? */
async function canAffordOneReveal(
  ctx: QueryCtx,
  org: Doc<"orgs">,
): Promise<boolean> {
  const credits = await findCreditsBucket(ctx, org._id);
  if (credits === null || bucketRemaining(credits) < ACTION_PRICES.get_email.credits) {
    return false;
  }
  const bucket = await findBucket(
    ctx,
    org._id,
    "enrich_credits",
    dailyPeriodKey(org, Date.now()),
  );
  // No bucket yet means the day is untouched, not unlimited — the reserve
  // will create it from the trial cap, which is more than one reveal.
  return bucket === null || bucketRemaining(bucket) >= REVEAL_CREDITS_PER_LEAD;
}

/**
 * The approved leads whose address the agent should buy now.
 *
 * Only `sourced` leads carry the reference the email finder needs, and only a
 * `locked` one is unknown — `revealing` is already in flight (and carries its
 * own watchdog), `found` is bought and `not_found` was bought and had none.
 */
async function selectRevealTargets(
  ctx: QueryCtx,
  agent: Doc<"agents">,
  limit: number,
): Promise<Id<"prospects">[]> {
  if (limit <= 0) {
    return [];
  }
  const approved = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_approval", (q) =>
      q.eq("orgId", agent.orgId).eq("approval", "approved"),
    )
    .order("desc")
    .take(CANDIDATE_SCAN_MAX);
  const targets: Id<"prospects">[] = [];
  for (const lead of approved) {
    if (targets.length >= limit) {
      break;
    }
    if (
      lead.agentId === agent._id &&
      lead.emailStatus === "locked" &&
      lead.research.status === "researched" &&
      lead.research.aiScore >= AUTO_REVEAL_MIN_SCORE &&
      lead.stage !== "rejected" &&
      lead.stage !== "closed_lost" &&
      lead.stage !== "needs_attention" &&
      lead.lastReplyAt === undefined
    ) {
      targets.push(lead._id);
    }
  }
  return targets;
}
