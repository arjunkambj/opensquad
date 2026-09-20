/**
 * The recovery sweep (PLAN §9.1). Convex does not re-run a failed action, so
 * THIS is the retry mechanism: every ten minutes it looks for work that lost
 * its scheduled function and puts it back.
 *
 * Three things go missing, and each is reconciled against evidence rather
 * than assumed:
 *
 *   An expired run lease. The action holding it is long dead — a Convex
 *   action cannot outlive ~10 minutes — so the lease is dropped and the agent
 *   becomes due again. A live agent that somehow holds neither a lease nor a
 *   due time is given one, so a lost schedule can never strand an agent.
 *
 *   A lead stuck in `researching` past its watchdog. Its step died without
 *   writing, which IS a failed attempt, so it goes through the same ladder a
 *   visible failure would: retry, retry, then `needs_attention`.
 *
 *   An `uncertain` email-finder hold. This one is NOT ours to settle: the
 *   provider is asked what its job did, and only that answer may release the
 *   hold. We never hand back money we may have spent — the billing sweep's
 *   24-hour worst-case commit is the other end of the same rule, and this
 *   pass exists to reach the hold with a real answer first.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { actionOfOperationKey } from "../billing/paidCall";
import { RESEARCH_STALL_MS } from "../leads/researchState";
import { SWEEP_BATCH_SIZE } from "../lib/limits";
import { v } from "convex/values";

/**
 * How long an `uncertain` email-finder hold is left to the reveal's own
 * polling before this sweep goes and asks. The poller gives up after about
 * two minutes, so anything older than this has nobody looking at it.
 *
 * Belongs in `convex/lib/limits.ts` with the other recovery windows; local
 * only because that file is integrator-only (EXECUTION §0).
 */
const REVEAL_RECONCILE_AFTER_MS = 5 * 60 * 1000;

/** Due leads examined per workspace per pass. */
const STALLED_LEAD_SCAN = 25;

export const sweepStalledRuns = internalMutation({
  args: {},
  returns: v.object({
    agents: v.number(),
    leasesReclaimed: v.number(),
    runsRescheduled: v.number(),
    leadsRecovered: v.number(),
    holdsReconciled: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_status_and_nextRunAt", (q) => q.eq("status", "live"))
      .take(SWEEP_BATCH_SIZE);

    let leasesReclaimed = 0;
    let runsRescheduled = 0;
    let leadsRecovered = 0;

    for (const agent of agents) {
      if (agent.run !== undefined && agent.run.leaseUntil <= now) {
        // Dropping the lease is safe precisely because it expired: any step
        // still holding it re-checks `leaseId` before writing and stops.
        await ctx.db.patch("agents", agent._id, {
          run: undefined,
          nextRunAt: now,
          updatedAt: now,
        });
        leasesReclaimed += 1;
      } else if (agent.run === undefined && agent.nextRunAt === undefined) {
        // Live, not running, and not scheduled: a lost schedule. The cron's
        // index range would never reach it again.
        await ctx.db.patch("agents", agent._id, {
          nextRunAt: now,
          updatedAt: now,
        });
        runsRescheduled += 1;
      }

      const due = await ctx.db
        .query("prospects")
        .withIndex("by_workspaceId_and_nextActionAt", (q) =>
          q
            .eq("workspaceId", agent.workspaceId)
            .gte("nextActionAt", 0)
            .lte("nextActionAt", now),
        )
        .take(STALLED_LEAD_SCAN);
      for (const lead of due) {
        if (lead.research.status !== "researching") {
          // A lead due for its next attempt is the planner's business, not
          // the sweep's.
          continue;
        }
        if (lead.research.startedAt > now - RESEARCH_STALL_MS) {
          continue;
        }
        await ctx.scheduler.runAfter(
          0,
          internal.leads.researchState.recoverStalledResearch,
          { prospectId: lead._id },
        );
        leadsRecovered += 1;
      }

      // The LEAD half of a stalled email reveal: the money half is settled
      // below through the provider's job, but a lead whose poller died would
      // stay `revealing` until someone clicked again. The mutation finds and
      // resolves that workspace's stalled leads itself, and is safe to repeat.
      await ctx.scheduler.runAfter(
        0,
        internal.leads.emailRevealState.recoverStalledReveals,
        { workspaceId: agent.workspaceId },
      );
    }

    const holds = await ctx.db
      .query("providerOperations")
      .withIndex("by_state_and_updatedAt", (q) =>
        q.eq("state", "uncertain").lt("updatedAt", now - REVEAL_RECONCILE_AFTER_MS),
      )
      .take(SWEEP_BATCH_SIZE);
    let holdsReconciled = 0;
    for (const hold of holds) {
      if (actionOfOperationKey(hold.operationKey) !== "get_email") {
        // Every other action's hold is settled by its own path, or by the
        // billing sweep's worst-case commit. Only the email finder has a job
        // that can still be asked what it did.
        continue;
      }
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.enrich.revealPoll.reconcileRevealOperation,
        { workspaceId: hold.workspaceId, operationKey: hold.operationKey },
      );
      holdsReconciled += 1;
    }

    return {
      agents: agents.length,
      leasesReclaimed,
      runsRescheduled,
      leadsRecovered,
      holdsReconciled,
    };
  },
});
