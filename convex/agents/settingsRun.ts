/**
 * The three controls on `/agent` that change what the NEXT run does: which
 * signals it sources from, when it runs, and which parked lead it should try
 * again (PLAN §9.1, EXECUTION T32).
 *
 * None of them does the work. Toggling a signal writes one boolean, and the
 * planner reads `strategies.enabled` before every single step, so the change
 * takes effect by itself. "Run now" takes the lease through the run loop's own
 * single-flight door. Retry puts a parked lead back in the queue the planner
 * already reads. Nothing here calls a provider or spends a credit — the run
 * steps do that, under `withCredits`, where they always did.
 */
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { appendLeadEvent } from "../leads/events";
import { requireWorkspaceEditor } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import {
  boundedString,
  domainError,
  leadScoreKey,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  vLeadStage,
} from "../lib/validators";
import type { LeadResearch, LeadStage } from "../lib/validators";
import { v } from "convex/values";

/** What a retried lead's history records. */
const RETRY_STAGE_REASON = "Put back in the queue by the workspace";

/**
 * Switch one signal on or off.
 *
 * There is nothing to schedule: `agents/runPlan.ts` reads the agent's enabled
 * strategies at the top of every step, so a signal switched off stops being
 * searched from the next step onwards, and one switched on is picked up the
 * same way. Work already done for it is kept — the leads it found are the
 * user's leads whatever the signal's state now is.
 */
export const setStrategyEnabled = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    strategyId: v.id("strategies"),
    enabled: v.boolean(),
  },
  returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const strategy = await ctx.db.get("strategies", args.strategyId);
    if (strategy === null || strategy.workspaceId !== args.workspaceId) {
      // A strategy in another workspace is the same NOT_FOUND as a missing
      // one — existence never leaks across a workspace boundary.
      throw domainError("NOT_FOUND", "signal not found");
    }
    if (strategy.enabled !== args.enabled) {
      await ctx.db.patch("strategies", strategy._id, {
        enabled: args.enabled,
        updatedAt: Date.now(),
      });
    }
    return { enabled: args.enabled };
  },
});

/** Why "Run now" did or did not start a run — `agents/run.ts`'s own answer. */
export type RunNowResult = {
  started: boolean;
  reason: "started" | "already_running" | "not_live" | "not_found";
};

/**
 * "Run now" — the public half of the run loop's entry point.
 *
 * The rate limit is per USER and sits in front of the lease, because this is
 * the one button that can start paid work on demand (PLAN §6 "Closing the
 * ways in"). Everything after it is the run loop's own single-flight rule:
 * two quick clicks produce ONE run, and the second is told so rather than
 * silently doing nothing.
 */
export const runNow = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
  },
  returns: v.object({
    started: v.boolean(),
    reason: v.union(
      v.literal("started"),
      v.literal("already_running"),
      v.literal("not_live"),
      v.literal("not_found"),
    ),
  }),
  // Annotated because the handler calls back into `internal`, which is the
  // generated graph this module is part of: without it the inference is
  // circular and every module in that graph loses its types.
  handler: async (ctx, args): Promise<RunNowResult> => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    await requireRateLimit(ctx, "runAgentNow", identityKey);
    return await ctx.runMutation(internal.agents.run.requestRun, {
      workspaceId: args.workspaceId,
      agentId: args.agentId,
    });
  },
});

/**
 * Put one parked lead back in the queue — the Retry button beside a
 * needs-attention row.
 *
 * `needs_attention` is the end of the retry ladder (PLAN §9.1): three step
 * failures, then the lead waits for a person. This is that person's answer,
 * so it clears the ladder rather than continuing it — `lastError` goes, the
 * attempt count starts again, and the lead becomes due immediately. The
 * planner selects on stage `found` plus a due time, so that is the state it
 * is returned to; a lead that already had a score keeps it and goes back to
 * `researched` instead of paying to research it twice.
 *
 * Only a parked lead may be retried. Nothing else is re-queueable this way,
 * so a rejected or closed lead cannot be revived through this door.
 */
export const retryLead = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ stage: vLeadStage }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "lead not found");
    }
    if (lead.stage !== "needs_attention") {
      throw domainError("CONFLICT", "only a parked lead can be retried");
    }

    const now = Date.now();
    const researched = lead.research.status === "researched";
    const research: LeadResearch = researched
      ? lead.research
      : { status: "not_researched" };
    const stage: LeadStage = researched ? "researched" : "found";
    await ctx.db.patch("prospects", args.prospectId, {
      research,
      // Written in the same patch as `research`, never alone (PLAN §7).
      scoreKey: leadScoreKey(research),
      stage,
      stageReason: boundedString(RETRY_STAGE_REASON, "stageReason", {
        min: 1,
        max: PROSPECT_STAGE_REASON_MAX_LENGTH,
      }),
      lastError: undefined,
      nextActionAt: now,
      updatedAt: now,
    });
    await appendLeadEvent(ctx, {
      workspaceId: lead.workspaceId,
      prospectId: lead._id,
      kind: "stage_changed",
      summary: RETRY_STAGE_REASON,
      operationKey: `lead:${lead._id}:retry:${now}`,
      actor: { source: "human", identityKey },
      fromStage: lead.stage,
      toStage: stage,
    });
    return { stage };
  },
});
