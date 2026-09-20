/**
 * The outreach loop's heartbeat (PLAN §9.1 "steps, not loops", §9.3).
 *
 * Not a run and not a lease: one bounded pass over the live agents that are
 * in a sending mode, which for each of them decides at most a handful of
 * single steps and schedules them. Every step claims its own lead in its own
 * transaction before spending anything, so two ticks racing — or a tick
 * racing a recovery sweep — produce one claim and the loser finds a lead that
 * is no longer due.
 *
 * The order is the order of the pipeline, and it is not an accident:
 *
 *   1. LEAD APPROVAL, because an unapproved lead is eligible for nothing.
 *      Free, and Autopilot only (`leads/autoApproval.ts`).
 *   2. INVALIDATION, because a draft written under wording the user has since
 *      changed must be retired before the lead is looked at as "already has a
 *      draft" (`outreachInvalidation.ts`).
 *   3. EMAIL REVEAL, because a lead with no address cannot be written to
 *      (`outreachReveal.ts`).
 *   4. WRITING, first touches and follow-ups alike (`outreachWrite.ts`).
 *
 * Sending is deliberately absent: writing hands off to the approval — a
 * person's in Review, Autopilot's own in Autopilot — and the approval hands
 * off to the UNCHANGED send ledger, which owns the window, the daily limit,
 * the idempotency key and every gate.
 *
 * NOTHING NEW STARTS while the agent is paused or in `sourcing_only`, while
 * the workspace is paused, while its inbox is not connected, or while the
 * platform kill switch is on. Work already in flight finishes and writes its
 * result, and unsent drafts stay drafts (PLAN §9.1).
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { SWEEP_BATCH_SIZE } from "../lib/limits";
import { agentRunsOutreach, selectStaleRevisionLeads, selectWriteTargets } from "./outreachPlan";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Per-pass bounds                                                     */
/*                                                                     */
/* These belong in `convex/lib/limits.ts` with the rest of the policy  */
/* numbers; they are local constants only because that file is         */
/* integrator-only (EXECUTION §0).                                     */
/* ------------------------------------------------------------------ */

/** Leads one agent may have approved in one pass. Free, so the bound is
 *  about transaction size rather than money. */
const APPROVALS_PER_TICK = 10;

/** Leads whose stale-revision drafts one pass retires. */
const REFRESHES_PER_TICK = 5;

/** Addresses one agent may start buying in one pass — the expensive step. */
const REVEALS_PER_TICK = 3;

/** Messages one agent may have written in one pass, at one credit each. */
const WRITES_PER_TICK = 3;

const vTickResult = v.object({
  agents: v.number(),
  leadsApproved: v.number(),
  draftsRefreshed: v.number(),
  revealsStarted: v.number(),
  writesScheduled: v.number(),
});

/**
 * One pass of the outreach loop. Registered as the `outreach-tick` cron.
 *
 * The agent scan is the same exact index range the run loop uses — live
 * agents only — so draft agents are never paged through. A workspace whose
 * agent is not in a sending mode costs one document read and nothing else.
 */
export const tickOutreach = internalMutation({
  args: {},
  returns: vTickResult,
  handler: async (ctx): Promise<typeof vTickResult.type> => {
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_status_and_nextRunAt", (q) => q.eq("status", "live"))
      .take(SWEEP_BATCH_SIZE);

    let leadsApproved = 0;
    let draftsRefreshed = 0;
    let revealsStarted = 0;
    let writesScheduled = 0;

    for (const agent of agents) {
      const workspace = await ctx.db.get("workspaces", agent.workspaceId);
      if (workspace === null || !agentRunsOutreach(workspace, agent)) {
        continue;
      }

      // 1. Autopilot's lead approval (PLAN §9.3). The mutation re-checks the
      //    mode and the recorded consent itself — Autopilot is never entered
      //    here, only acted on.
      if (agent.mode === "autopilot") {
        const approved = await ctx.runMutation(
          internal.leads.autoApproval.autoApproveForAgent,
          { agentId: agent._id, limit: APPROVALS_PER_TICK },
        );
        leadsApproved += approved.approved;
      }

      // 2. Drafts written under wording that has since changed.
      const stale = await selectStaleRevisionLeads(ctx, agent, REFRESHES_PER_TICK);
      for (const prospectId of stale) {
        const refreshed = await ctx.runMutation(
          internal.outreach.outreachInvalidation.refreshStaleRevisionLead,
          { agentId: agent._id, prospectId },
        );
        if (refreshed.refreshed) {
          draftsRefreshed += 1;
        }
      }

      // 3. Addresses for approved leads.
      const reveals = await ctx.runMutation(
        internal.outreach.outreachReveal.claimAutoReveals,
        { agentId: agent._id, limit: REVEALS_PER_TICK },
      );
      revealsStarted += reveals.started;

      // 4. The messages themselves. Scheduled rather than run: each one
      //    performs a paid call, which only an action may do, and each claims
      //    its lead in its own transaction before spending.
      const targets = await selectWriteTargets(ctx, agent, WRITES_PER_TICK);
      for (const target of targets) {
        await ctx.scheduler.runAfter(
          0,
          internal.outreach.outreachWrite.runOutreachWriteStep,
          {
            agentId: agent._id,
            prospectId: target.prospectId,
            step: target.step,
          },
        );
        writesScheduled += 1;
      }
    }

    return {
      agents: agents.length,
      leadsApproved,
      draftsRefreshed,
      revealsStarted,
      writesScheduled,
    };
  },
});
