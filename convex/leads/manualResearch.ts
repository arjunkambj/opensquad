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
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { bucketRemaining, findBucket } from "../billing/model";
import { requireWorkspaceEditor } from "../lib/auth";
import { ACTION_PRICES } from "../lib/limits";
import { requireRateLimit } from "../lib/rateLimits";
import {
  domainError,
  invalid,
  leadScoreKey,
  USAGE_PERIOD_LIFETIME,
} from "../lib/validators";
import type { LeadResearch } from "../lib/validators";
import { loadProspectForWrite } from "./model";
import { RESEARCH_STALL_MS } from "./researchState";
import { v } from "convex/values";

/** Leads one manual request may start. Research is three credits each, and
 *  the page allowance is a day-keyed cap — a selection of ten is already more
 *  than a trial day's worth. */
const MANUAL_RESEARCH_MAX = 10;

const vSkipReason = v.union(
  v.literal("already_researched"),
  v.literal("in_flight"),
  v.literal("rejected"),
  v.literal("credits"),
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
    workspaceId: v.id("workspaces"),
    prospectIds: v.array(v.id("prospects")),
  },
  returns: v.object({
    started: v.number(),
    creditsPerLead: v.number(),
    skipped: v.array(
      v.object({ prospectId: v.id("prospects"), reason: vSkipReason }),
    ),
  }),
  handler: async (ctx, args) => {
    const { identityKey, workspace } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
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
    const price = ACTION_PRICES.research_lead.credits;
    const credits = await findBucket(
      ctx,
      workspace._id,
      "credits",
      USAGE_PERIOD_LIFETIME,
    );
    if (credits === null) {
      throw domainError(
        "NO_CREDIT_GRANT",
        "this workspace has no credit grant; no paid step can run",
      );
    }
    const affordable = Math.floor(bucketRemaining(credits) / price);
    if (affordable === 0) {
      throw domainError(
        "INSUFFICIENT_CREDITS",
        "not enough credits to research a lead",
      );
    }

    const now = Date.now();
    let started = 0;
    const skipped: {
      prospectId: Id<"prospects">;
      reason: typeof vSkipReason.type;
    }[] = [];
    for (const prospectId of new Set(args.prospectIds)) {
      const lead = await loadProspectForWrite(ctx, args.workspaceId, prospectId);
      if (lead.approval === "rejected") {
        skipped.push({ prospectId, reason: "rejected" });
        continue;
      }
      if (lead.research.status === "researched") {
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
      await claim(ctx, lead, now);
      await ctx.scheduler.runAfter(
        0,
        internal.leads.manualResearchRun.runManualResearch,
        {
          workspaceId: args.workspaceId,
          prospectId,
          claimedAt: now,
        },
      );
      started += 1;
    }
    return { started, creditsPerLead: price, skipped };
  },
});

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
    updatedAt: now,
    ...(lead.stage === "needs_attention"
      ? { stage: "found" as const, stageReason: "Retried by a team member" }
      : {}),
  });
}
