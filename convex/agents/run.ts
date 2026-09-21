/**
 * The agent run loop (PLAN §9.1 "Background execution").
 *
 * A run is not a long action. It is a LEASE plus a chain of short steps: the
 * cron (or "Run now") takes the lease, `advanceRun` decides the next single
 * step and schedules it, the step performs exactly one provider call, writes
 * its result, and schedules `advanceRun` again. Nothing depends on finishing
 * a batch inside one action's timeout, and every step is safe to run twice.
 *
 * Three invariants hold the loop together:
 *
 *   SINGLE FLIGHT. `agents.run { leaseId, leaseUntil, startedAt }` is taken in
 *   one serializable transaction only when no live lease exists, so two
 *   simultaneous triggers produce one run and the second is a no-op that says
 *   "already running". Every step re-checks it still holds `leaseId` before
 *   writing; a lost lease stops quietly rather than racing the run that took
 *   it over.
 *
 *   THE SWEEP IS THE RETRY. Convex does not re-run a failed action, so a step
 *   that dies leaves the lease to expire and `agents/recovery.ts` re-drives
 *   it. Nothing here retries in memory.
 *
 *   NOTHING NEW WHILE PAUSED. A paused agent, a draft agent and a paused
 *   platform all plan to `idle`: the step already in flight finishes its
 *   provider call and writes its result, and then the run ends.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { recordRunFinished } from "../activity/model";
import { SWEEP_BATCH_SIZE } from "../lib/limits";
import { planNextStep } from "./runPlan";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Run timing                                                          */
/*                                                                     */
/* These belong in `convex/lib/limits.ts` with the rest of the policy  */
/* numbers; they are local constants only because that file is         */
/* integrator-only (EXECUTION §0).                                     */
/* ------------------------------------------------------------------ */

/** PLAN §9.1: "Lease 5 min, renewed per step". A crashed run is reclaimable
 *  once it expires, and no step takes anything like this long. */
export const AGENT_RUN_LEASE_MS = 5 * 60 * 1000;

/** How long after a finished run the next one is due. Hourly: the caps that
 *  matter are daily, and an hour is short enough that a user who edits a
 *  signal sees new leads the same afternoon. */
export const AGENT_RUN_INTERVAL_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Lease and revision fencing — the helpers later steps program against */
/* ------------------------------------------------------------------ */

/** Is this agent's lease still live at `at`? */
export function runLeaseIsLive(agent: Doc<"agents">, at: number): boolean {
  return agent.run !== undefined && agent.run.leaseUntil > at;
}

/**
 * Does `leaseId` still own this agent's run? THE check every step makes
 * before it writes: a step whose lease was taken over must stop quietly, not
 * write over the newer run's work.
 */
export function holdsRunLease(agent: Doc<"agents">, leaseId: string): boolean {
  return agent.run !== undefined && agent.run.leaseId === leaseId;
}

/**
 * Revision fencing (PLAN §9.1). Work is queued under the revision it was
 * planned at; when the agent's instructions, tone, goal, ICP or mode change,
 * `revision` moves and everything still queued under the old one is stale.
 *
 * Exported for the outreach loop, which fences drafts the same way.
 */
export function revisionIsCurrent(
  agent: Doc<"agents">,
  revision: number,
): boolean {
  return agent.revision === revision;
}

/** The lease a step is running under, or `null` when it no longer holds it. */
export async function leasedAgent(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  leaseId: string,
): Promise<Doc<"agents"> | null> {
  const agent = await ctx.db.get("agents", agentId);
  return agent !== null && holdsRunLease(agent, leaseId) ? agent : null;
}

/** Push the lease out by another step's worth of time. */
export async function renewRunLease(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  leaseId: string,
): Promise<void> {
  if (agent.run === undefined || agent.run.leaseId !== leaseId) {
    return;
  }
  await ctx.db.patch("agents", agent._id, {
    run: { ...agent.run, leaseUntil: Date.now() + AGENT_RUN_LEASE_MS },
    updatedAt: Date.now(),
  });
}

/**
 * Take the lease, or report that a run already holds it.
 *
 * The read and the write are in ONE serializable transaction, which is what
 * makes "two simultaneous Run now clicks produce one run" true without a
 * unique index — the same discipline as one agent per org.
 */
export async function takeRunLease(
  ctx: MutationCtx,
  agent: Doc<"agents">,
): Promise<string | null> {
  const now = Date.now();
  if (runLeaseIsLive(agent, now)) {
    return null;
  }
  const leaseId = crypto.randomUUID();
  await ctx.db.patch("agents", agent._id, {
    run: { leaseId, leaseUntil: now + AGENT_RUN_LEASE_MS, startedAt: now },
    // The run owns the agent now, so it is no longer waiting for one. The
    // next due time is written when the run ends.
    nextRunAt: undefined,
    updatedAt: now,
  });
  return leaseId;
}

/**
 * End the run: drop the lease and say when the next one is due.
 *
 * A live agent is always re-scheduled, whatever the reason it stopped —
 * "out of credits" and "the platform is paused" are conditions that change on
 * their own, and an agent that stopped asking would never notice. A draft
 * agent is left with no due time at all, so the cron's index range never
 * pages through one.
 */
export async function finishRun(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  leaseId: string,
): Promise<void> {
  if (!holdsRunLease(agent, leaseId)) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch("agents", agent._id, {
    run: undefined,
    lastRunAt: now,
    ...(agent.status === "live"
      ? { nextRunAt: now + AGENT_RUN_INTERVAL_MS }
      : { nextRunAt: undefined }),
    updatedAt: now,
  });
  // The bell's "run finished" event (PLAN §5). Behind the lease check above,
  // so only the run that actually held the lease reports finishing.
  await recordRunFinished(ctx, {
    orgId: agent.orgId,
    agentId: agent._id,
    finishedAt: now,
  });
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

const vRunRequest = v.object({
  started: v.boolean(),
  reason: v.union(
    v.literal("started"),
    v.literal("already_running"),
    v.literal("not_live"),
    v.literal("not_found"),
  ),
});

/**
 * "Run now" — the internal half of the Agent page's button (T32 owns the
 * public mutation that authenticates, rate-limits and calls this).
 *
 * A second trigger while a run holds the lease is a no-op that says so. A
 * paused agent still starts: the run takes the lease, plans `idle` and ends,
 * which is the honest answer to "run now" on a paused agent and costs one
 * transaction.
 */
export const requestRun = internalMutation({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
  },
  returns: vRunRequest,
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null || agent.orgId !== args.orgId) {
      return { started: false, reason: "not_found" as const };
    }
    if (agent.status !== "live") {
      return { started: false, reason: "not_live" as const };
    }
    const leaseId = await takeRunLease(ctx, agent);
    if (leaseId === null) {
      return { started: false, reason: "already_running" as const };
    }
    await ctx.scheduler.runAfter(0, internal.agents.run.advanceRun, {
      agentId: agent._id,
      leaseId,
    });
    return { started: true, reason: "started" as const };
  },
});

/**
 * The `agent-run` cron: start a run for every live agent whose `nextRunAt` is
 * due. The index range is exact — `status: "live"` with a due time between 0
 * and now — so draft agents and agents mid-run (whose due time is cleared
 * while the lease is held) are never paged through.
 */
export const tickDueAgents = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), started: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("agents")
      .withIndex("by_status_and_nextRunAt", (q) =>
        q.eq("status", "live").gte("nextRunAt", 0).lte("nextRunAt", now),
      )
      .take(SWEEP_BATCH_SIZE);
    let started = 0;
    for (const agent of due) {
      if (agent.mode === "paused") {
        // Nothing new starts while paused, and re-planning it every minute
        // would be noise: push the due time out and look again later.
        await ctx.db.patch("agents", agent._id, {
          nextRunAt: now + AGENT_RUN_INTERVAL_MS,
          updatedAt: now,
        });
        continue;
      }
      const leaseId = await takeRunLease(ctx, agent);
      if (leaseId === null) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.agents.run.advanceRun, {
        agentId: agent._id,
        leaseId,
      });
      started += 1;
    }
    return { scanned: due.length, started };
  },
});

/**
 * End the run from inside a step.
 *
 * A step that was REFUSED — the trial's hidden provider cap is spent, the
 * platform budget is gone, the balance cannot cover the next call — must not
 * hand back to `advanceRun`, because the planner cannot see a cap it did not
 * take and would schedule the very same step again. Ending the run is the
 * clean stop PLAN §6 asks for: nothing is retried in a loop, the next run is
 * due in an hour, and every free part of the app keeps working.
 */
export const endRun = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await leasedAgent(ctx, args.agentId, args.leaseId);
    if (agent !== null) {
      await finishRun(ctx, agent, args.leaseId);
    }
    return null;
  },
});

/**
 * Decide and schedule ONE step, or end the run.
 *
 * Called at the start of a run and again by every step that finishes, so this
 * is the only place that knows what a run is made of — and the only place
 * that renews the lease.
 */
export const advanceRun = internalMutation({
  args: {
    agentId: v.id("agents"),
    leaseId: v.string(),
  },
  returns: v.object({ step: v.string() }),
  handler: async (ctx, args) => {
    const agent = await leasedAgent(ctx, args.agentId, args.leaseId);
    if (agent === null) {
      // The lease moved on; whoever holds it now is driving.
      return { step: "lease_lost" };
    }
    const step = await planNextStep(ctx, agent);
    if (step.kind === "idle") {
      await finishRun(ctx, agent, args.leaseId);
      return { step: `idle:${step.reason}` };
    }
    await renewRunLease(ctx, agent, args.leaseId);
    if (step.kind === "source") {
      await ctx.scheduler.runAfter(0, internal.agents.sourcing.runSourcingStep, {
        agentId: agent._id,
        leaseId: args.leaseId,
        strategyId: step.strategyId,
        page: step.page,
      });
      return { step: "source" };
    }
    await ctx.scheduler.runAfter(0, internal.leads.research.runResearchStep, {
      agentId: agent._id,
      leaseId: args.leaseId,
      prospectId: step.prospectId,
    });
    return { step: "research" };
  },
});
