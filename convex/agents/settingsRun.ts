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
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { LEAD_RETRY_REASON, unparkLead } from "../leads/model";
import { requireOrgMember } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import { domainError, invalid, vLeadStage } from "../lib/validators";
import { strategyIsSelectable } from "./strategiesModel";
import { v } from "convex/values";

/**
 * Switch one signal on or off.
 *
 * There is nothing to schedule: `agents/runPlan.ts` reads the agent's enabled
 * strategies at the top of every step, so a signal switched off stops being
 * searched from the next step onwards, and one switched on is picked up the
 * same way. Work already done for it is kept — the leads it found are the
 * user's leads whatever the signal's state now is.
 *
 * A signal that matches NOBODY cannot be switched on here, exactly as setup
 * and confirm refuse it (`strategiesModel.ts`): the run would buy a page of
 * search that can only come back empty, and this was the one door into the
 * agent that did not check.
 *
 * Switching a signal on is also how a PARKED one is un-parked: a search
 * refused its filters once, the planner stopped choosing it, and the person
 * answering that is saying "try it again". If the filters are still unusable
 * the next run parks it again, with its reason.
 */
export const setStrategyEnabled = mutation({
  args: {
    orgId: v.id("orgs"),
    strategyId: v.id("strategies"),
    enabled: v.boolean(),
  },
  returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const strategy = await ctx.db.get("strategies", args.strategyId);
    if (strategy === null || strategy.orgId !== args.orgId) {
      // A strategy in another org is the same NOT_FOUND as a missing
      // one — existence never leaks across an org boundary.
      throw domainError("NOT_FOUND", "signal not found");
    }
    if (args.enabled && !strategyIsSelectable(strategy.matchCount)) {
      throw invalid(
        "this signal matches nobody, so switching it on would search for no one",
      );
    }
    const parked = strategy.lastError !== undefined;
    if (strategy.enabled !== args.enabled || (args.enabled && parked)) {
      await ctx.db.patch("strategies", strategy._id, {
        enabled: args.enabled,
        ...(args.enabled ? { lastError: undefined } : {}),
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
    orgId: v.id("orgs"),
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
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    await requireRateLimit(ctx, "runAgentNow", identityKey);
    return await ctx.runMutation(internal.agents.run.requestRun, {
      orgId: args.orgId,
      agentId: args.agentId,
    });
  },
});

/**
 * Put one parked lead back in the queue — the Retry button beside a
 * needs-attention row.
 *
 * The write itself is `leads/model.ts#unparkLead`, the one writer of that
 * transition, so this button and Contacts' Retry leave a lead in exactly the
 * same state. It is FREE: un-parking buys nothing, and the research the
 * planner then does costs the ordinary 3 credits once, whichever door the
 * person used (PLAN §6).
 *
 * The lead is due immediately, and so is the AGENT: the card says "Retry puts
 * one back in the queue for the next run", and without nudging `nextRunAt`
 * the next run was up to an hour away. A run holding the lease is left alone
 * — it is already working, and it reads the lead's due time at every step.
 *
 * Rate-limited even though it spends nothing directly, because what it does
 * is push a lead back into the paid loop (PLAN §6 "Closing the ways in").
 *
 * Only a parked lead may be retried. Nothing else is re-queueable this way,
 * so a rejected or closed lead cannot be revived through this door.
 */
export const retryLead = mutation({
  args: {
    orgId: v.id("orgs"),
    prospectId: v.id("prospects"),
  },
  returns: v.object({ stage: vLeadStage }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    await requireRateLimit(ctx, "retryLead", identityKey);
    const lead = await ctx.db.get("prospects", args.prospectId);
    if (lead === null || lead.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "lead not found");
    }
    if (lead.stage !== "needs_attention") {
      throw domainError("CONFLICT", "only a parked lead can be retried");
    }

    const now = Date.now();
    const stage = await unparkLead(ctx, lead, {
      reason: LEAD_RETRY_REASON,
      now,
      identityKey,
    });
    await nudgeAgent(ctx, lead.agentId, now);
    return { stage };
  },
});

/**
 * Make this agent due now, unless a run already holds it.
 *
 * The cron starts a run for every live agent whose `nextRunAt` has come, so
 * this is the whole handover — nothing here takes a lease, schedules a step
 * or spends anything, and a paused or draft agent is left exactly as it is.
 */
async function nudgeAgent(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  now: number,
): Promise<void> {
  const agent = await ctx.db.get("agents", agentId);
  if (
    agent === null ||
    agent.status !== "live" ||
    agent.mode === "paused" ||
    agent.run !== undefined ||
    (agent.nextRunAt !== undefined && agent.nextRunAt <= now)
  ) {
    return;
  }
  await ctx.db.patch("agents", agent._id, { nextRunAt: now, updatedAt: now });
}
