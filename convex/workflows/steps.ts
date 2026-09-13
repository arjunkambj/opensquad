/**
 * Mission workflow steps — internal mutations that mission workflows execute
 * through `step.runMutation`. Every step is journaled: once committed it is
 * never re-executed on replay, and each writes its own receipts (runs,
 * activity, branch rows) so a backend restart mid-wait never double-applies.
 *
 * Shared helpers at the bottom (`transitionMission`, `cancelMissionWork`,
 * `failMission`, `completeMissionTx`, `finalizeBranch`) are also called
 * directly by `missions.ts` — they compose inside the same transaction.
 */
import {
  cancel,
  createEvent,
  getStatus,
  sendEvent,
  start,
  vResultValidator,
} from "@convex-dev/workflow";
import type { WorkflowId, EventId } from "@convex-dev/workflow";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  aggregateMissionOutcome,
  assertMissionTransition,
  boardColumnForMission,
  boundedString,
  domainError,
  invalid,
  vMissionOutcome,
  vMissionProspectOutcome,
} from "../lib/validators";
import type {
  MissionOutcome,
  MissionProspectOutcome,
  MissionState,
} from "../lib/validators";
import { recordActivityEvent } from "../activity";
import type { WriteCtx } from "../activity";
import { finishRun, insertRun, sweepRuns } from "../runs";
import { retireAllOpenDecisions } from "../decisions";
import { vBranchCompletion } from "./events";

const vGateResult = v.object({
  action: v.union(
    v.literal("proceed"),
    v.literal("wait"),
    v.literal("abandon"),
  ),
  reason: v.optional(v.string()),
});

type GateResult = {
  action: "proceed" | "wait" | "abandon";
  reason?: string;
};

/** "Event already sent/consumed" is a no-op for idempotent signal paths. */
function isAlreadyDelivered(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Event already sent") ||
    message.includes("Event already consumed")
  );
}

async function getMissionOrThrow(
  ctx: WriteCtx,
  missionId: Id<"missions">,
): Promise<Doc<"missions">> {
  const mission = await ctx.db.get("missions", missionId);
  if (mission === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  return mission;
}

/**
 * Validated mission state transition — asserts the §6 transition table,
 * recomputes the board column, bumps `version` and records one deduped
 * `mission_state_changed` receipt (keyed on the new version).
 */
export async function transitionMission(
  ctx: WriteCtx,
  mission: Doc<"missions">,
  to: MissionState,
  opts: {
    actor: string;
    summary: string;
    kind?: string;
    patch?: Partial<
      Pick<
        Doc<"missions">,
        "progressSummary" | "completedAt" | "failure" | "outcome"
      >
    >;
  },
): Promise<Doc<"missions">> {
  if (mission.state === to) {
    return mission;
  }
  assertMissionTransition(mission.state, to);
  const version = mission.version + 1;
  await ctx.db.patch("missions", mission._id, {
    state: to,
    boardColumn: boardColumnForMission(to, mission.requiredDecisionCount),
    version,
    updatedAt: Date.now(),
    ...(opts.patch ?? {}),
  });
  await recordActivityEvent(ctx, {
    workspaceId: mission.workspaceId,
    missionId: mission._id,
    kind: opts.kind ?? "mission_state_changed",
    summary: opts.summary,
    actor: opts.actor,
    dedupeKey: `mission:${mission._id}:v${version}:${to}`,
  });
  const updated = await ctx.db.get("missions", mission._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  return updated;
}

/**
 * Dispatch gate — the workflow's first step. Transitions `queued` → `active`,
 * parks a mission that was paused before dispatch (`wait`), and abandons a
 * mission that was already terminated (`abandon`).
 */
export const gateMission = internalMutation({
  args: { missionId: v.id("missions") },
  returns: vGateResult,
  handler: async (ctx, args): Promise<GateResult> => {
    const mission = await getMissionOrThrow(ctx, args.missionId);
    switch (mission.state) {
      case "queued": {
        await transitionMission(ctx, mission, "active", {
          actor: "workflow",
          summary: "Mission dispatched",
          patch: { progressSummary: "Running" },
        });
        return { action: "proceed" };
      }
      case "active":
      case "waiting_for_user":
      case "waiting_for_runtime":
        return { action: "proceed" };
      case "paused":
        return { action: "wait", reason: "paused" };
      default:
        return { action: "abandon", reason: mission.state };
    }
  },
});

/**
 * Park the mission on its required asks — called right before the workflow
 * awaits a decision event so the card honestly reads Needs you.
 */
export const markAwaitingUser = internalMutation({
  args: { missionId: v.id("missions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mission = await getMissionOrThrow(ctx, args.missionId);
    if (mission.state !== "active") {
      return null;
    }
    await transitionMission(ctx, mission, "waiting_for_user", {
      actor: "workflow",
      summary: "Mission parked on a required decision",
      patch: { progressSummary: "Waiting on a required decision" },
    });
    return null;
  },
});

/**
 * Development-fixture scan stage. Deterministic — it produces two synthetic
 * prospect keys, validates them (bounded, unique, at most five branches) and
 * records a succeeded run receipt. This exists ONLY to exercise the durable
 * machinery (receipts → branches → decision → wait → continuation); it is not
 * discovery, enrichment or any AI/provider work — P09 replaces the stage body.
 */
export const devFixtureStage = internalMutation({
  args: { missionId: v.id("missions") },
  returns: v.object({
    prospectKeys: v.array(v.string()),
    summary: v.string(),
  }),
  handler: async (ctx, args) => {
    const mission = await getMissionOrThrow(ctx, args.missionId);
    if (mission.state !== "active") {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; the stage requires an active mission`,
      );
    }
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "dev_fixture_scan",
      generation: 1,
      inputVersion: mission.version,
      inputSummary: mission.inputSnapshot.requestedOutcome,
    });
    const run = await ctx.db.get("runs", runId);
    if (run === null) {
      throw domainError("NOT_FOUND", "run not found");
    }

    // Deterministic development-fixture output — synthetic keys, not real
    // prospect discovery.
    const prospectKeys = ["dev-prospect-1", "dev-prospect-2"];

    // Validated stage output: the run fails instead of trusting bad output.
    const unique = new Set(prospectKeys);
    if (
      prospectKeys.length === 0 ||
      prospectKeys.length > 5 ||
      unique.size !== prospectKeys.length
    ) {
      await finishRun(ctx, run, "failed", {
        errorMessage: "dev fixture produced invalid stage output",
      });
      throw invalid("dev fixture produced invalid stage output");
    }

    await finishRun(ctx, run, "succeeded", {
      outputRefs: [`dev-fixture:scan:${prospectKeys.join(",")}`],
      usage: { toolCalls: 0, modelCalls: 0 },
    });
    await ctx.db.patch("missions", mission._id, {
      progressSummary: `Fixture scan complete — ${prospectKeys.length} prospect branches`,
      updatedAt: Date.now(),
    });
    return {
      prospectKeys,
      summary: `${prospectKeys.length} synthetic prospect branches selected`,
    };
  },
});

/**
 * Register prospect branches and start their child workflows.
 *
 * The unique (missionId, prospectId) row IS the stable child start key: a
 * replayed step (e.g. after a crash between the step commit and the journal
 * write) finds the existing row, reuses its completion event and does not
 * start a second child workflow.
 */
export const registerBranches = internalMutation({
  args: {
    missionId: v.id("missions"),
    parentWorkflowId: v.string(),
    prospectKeys: v.array(v.string()),
  },
  returns: v.object({
    branches: v.array(
      v.object({
        branchId: v.id("missionProspects"),
        prospectId: v.string(),
        completionEventId: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const mission = await getMissionOrThrow(ctx, args.missionId);
    if (mission.state !== "active") {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; cannot start prospect branches`,
      );
    }
    const prospectKeys = args.prospectKeys.map((key, index) =>
      boundedString(key, `prospectKeys[${index}]`, { min: 1, max: 100 }),
    );
    if (new Set(prospectKeys).size !== prospectKeys.length) {
      throw invalid("prospectKeys must be unique");
    }
    if (prospectKeys.length > 5) {
      throw invalid("at most five prospect branches per dispatch");
    }

    const branches: {
      branchId: Id<"missionProspects">;
      prospectId: string;
      completionEventId: string;
    }[] = [];
    for (const prospectId of prospectKeys) {
      let branch = await ctx.db
        .query("missionProspects")
        .withIndex("by_missionId_and_prospectId", (q) =>
          q.eq("missionId", mission._id).eq("prospectId", prospectId),
        )
        .unique();
      if (branch === null) {
        // Create the parent's completion event first so the recorded event ID
        // is always backend-assigned before the child can signal it.
        const completionEventId = await createEvent(ctx, components.workflow, {
          name: `branch-complete:${prospectId}`,
          workflowId: args.parentWorkflowId as WorkflowId,
        });
        const branchId = await ctx.db.insert("missionProspects", {
          workspaceId: mission.workspaceId,
          missionId: mission._id,
          prospectId,
          generation: 1,
          createdAt: Date.now(),
          completionEventId,
        });
        const created = await ctx.db.get("missionProspects", branchId);
        if (created === null) {
          throw domainError("NOT_FOUND", "prospect branch not found");
        }
        branch = created;
      }
      if (branch.completionEventId === undefined) {
        throw invalid("prospect branch is missing its completion event");
      }
      if (branch.childWorkflowId === undefined) {
        const childWorkflowId = await start(
          ctx,
          internal.workflows.devFixture.devFixtureProspectWorkflow,
          { branchId: branch._id, missionId: mission._id },
          {
            startAsync: true,
            onComplete: internal.workflows.steps.onProspectWorkflowComplete,
            context: { branchId: branch._id, missionId: mission._id },
          },
        );
        await ctx.db.patch("missionProspects", branch._id, {
          childWorkflowId,
        });
        await recordActivityEvent(ctx, {
          workspaceId: mission.workspaceId,
          missionId: mission._id,
          kind: "prospect_branch_started",
          summary: `Prospect branch started: ${prospectId}`,
          actor: "workflow",
          dedupeKey: `branch:${branch._id}:started`,
          prospectId,
        });
      }
      branches.push({
        branchId: branch._id,
        prospectId,
        completionEventId: branch.completionEventId,
      });
    }
    return { branches };
  },
});

/**
 * Development-fixture branch stage. Deterministic outcome from the synthetic
 * key (odd → completed, even → contact_needed) so the parent aggregates a
 * `partial` result. Idempotent: a replayed step returns the recorded outcome.
 */
export const devFixtureBranchStage = internalMutation({
  args: { branchId: v.id("missionProspects") },
  returns: v.object({
    outcome: vMissionProspectOutcome,
    reason: v.string(),
  }),
  handler: async (ctx, args) => {
    const branch = await ctx.db.get("missionProspects", args.branchId);
    if (branch === null) {
      throw domainError("NOT_FOUND", "prospect branch not found");
    }
    if (branch.outcome !== undefined) {
      return {
        outcome: branch.outcome,
        reason: branch.outcomeReason ?? "already recorded",
      };
    }
    const mission = await getMissionOrThrow(ctx, branch.missionId);
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "dev_fixture_branch",
      generation: branch.generation,
      inputVersion: mission.version,
      inputSummary: `prospect branch ${branch.prospectId}`,
    });
    const run = await ctx.db.get("runs", runId);
    if (run === null) {
      throw domainError("NOT_FOUND", "run not found");
    }
    const suffix = Number.parseInt(
      branch.prospectId.replace(/^dev-prospect-/, ""),
      10,
    );
    const outcome: MissionProspectOutcome =
      Number.isNaN(suffix) || suffix % 2 === 1 ? "completed" : "contact_needed";
    const reason =
      outcome === "completed"
        ? "fixture produced an outreach draft"
        : "fixture found no usable contact";
    await finishRun(ctx, run, "succeeded", {
      outputRefs: [`dev-fixture:branch:${branch.prospectId}`],
      usage: { toolCalls: 0, modelCalls: 0 },
    });
    return { outcome, reason };
  },
});

/**
 * Record the explicit terminal outcome on a branch row and signal the
 * parent's completion event — transactionally, so the outcome and the
 * durable signal commit together. Idempotent: a duplicate call (or a child
 * `onComplete` fallback after success) keeps the recorded outcome.
 */
export async function finalizeBranch(
  ctx: MutationCtx,
  branch: Doc<"missionProspects">,
  outcome: MissionProspectOutcome,
  reason: string,
): Promise<void> {
  if (branch.outcome !== undefined) {
    return;
  }
  const boundedReason = boundedString(reason, "reason", { min: 1, max: 500 });
  await ctx.db.patch("missionProspects", branch._id, {
    outcome,
    outcomeReason: boundedReason,
    completedAt: Date.now(),
  });
  if (branch.completionEventId !== undefined) {
    try {
      await sendEvent(ctx, components.workflow, {
        id: branch.completionEventId as EventId,
        validator: vBranchCompletion,
        value: {
          branchId: branch._id,
          prospectId: branch.prospectId,
          outcome,
          reason: boundedReason,
        },
      });
    } catch (error) {
      if (!isAlreadyDelivered(error)) {
        throw error;
      }
    }
  }
  await recordActivityEvent(ctx, {
    workspaceId: branch.workspaceId,
    missionId: branch.missionId,
    kind: "prospect_branch_completed",
    summary: `Prospect branch ${branch.prospectId}: ${outcome} — ${boundedReason}`,
    actor: "workflow",
    dedupeKey: `branch:${branch._id}:completed`,
    prospectId: branch.prospectId,
  });
}

export const completeBranch = internalMutation({
  args: {
    branchId: v.id("missionProspects"),
    outcome: vMissionProspectOutcome,
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const branch = await ctx.db.get("missionProspects", args.branchId);
    if (branch === null) {
      throw domainError("NOT_FOUND", "prospect branch not found");
    }
    await finalizeBranch(ctx, branch, args.outcome, args.reason);
    return null;
  },
});

/**
 * Post-resolution continuation gate — the "recheck pause/cancel/current
 * inputs before continuing" step (§6). The event payload is a hint only:
 * the recorded decision row is re-validated (resolved at exactly the
 * delivered version, same workflow generation) so a stale or superseded
 * signal never advances the mission.
 */
export const checkContinuation = internalMutation({
  args: {
    missionId: v.id("missions"),
    decisionId: v.id("decisions"),
    decisionVersion: v.optional(v.number()),
  },
  returns: vGateResult,
  handler: async (ctx, args): Promise<GateResult> => {
    const mission = await getMissionOrThrow(ctx, args.missionId);
    const decision = await ctx.db.get("decisions", args.decisionId);
    if (decision === null || decision.missionId !== mission._id) {
      throw domainError("NOT_FOUND", "decision not found for this mission");
    }
    if (
      mission.state === "cancelled" ||
      mission.state === "completed" ||
      mission.state === "failed"
    ) {
      return { action: "abandon", reason: mission.state };
    }
    if (decision.state !== "resolved") {
      return { action: "abandon", reason: `decision_${decision.state}` };
    }
    if (
      args.decisionVersion !== undefined &&
      decision.version !== args.decisionVersion
    ) {
      return { action: "abandon", reason: "stale_decision_version" };
    }
    if (decision.workflowGeneration !== mission.workflowGeneration) {
      return { action: "abandon", reason: "stale_generation" };
    }
    if (mission.state === "paused") {
      return { action: "wait", reason: "paused" };
    }
    return { action: "proceed" };
  },
});

/**
 * Terminal completion: aggregate explicit child outcomes into the parent
 * outcome (§6.1 step 9 — partial / contact_needed / skipped are first-class),
 * then transition the mission to `completed`. Idempotent.
 */
export async function completeMissionTx(
  ctx: WriteCtx,
  mission: Doc<"missions">,
): Promise<MissionOutcome> {
  const fresh = await ctx.db.get("missions", mission._id);
  if (fresh === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  if (fresh.state === "completed") {
    return fresh.outcome?.kind ?? "completed";
  }
  if (fresh.state === "cancelled" || fresh.state === "failed") {
    return fresh.state;
  }
  const branches = await ctx.db
    .query("missionProspects")
    .withIndex("by_missionId_and_prospectId", (q) =>
      q.eq("missionId", fresh._id),
    )
    .collect();
  const outcomes: MissionProspectOutcome[] = branches.map(
    (branch) => branch.outcome ?? "failed",
  );
  const kind = aggregateMissionOutcome(outcomes);
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  const summary =
    branches.length === 0
      ? "Mission completed"
      : `Mission completed — ${branches.length} prospect branches: ` +
        [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ");
  await transitionMission(ctx, fresh, "completed", {
    actor: "workflow",
    kind: "mission_completed",
    summary,
    patch: {
      completedAt: Date.now(),
      outcome: { kind, summary },
      progressSummary: summary,
    },
  });
  return kind;
}

export const completeMission = internalMutation({
  args: { missionId: v.id("missions") },
  returns: v.object({ outcome: vMissionOutcome }),
  handler: async (ctx, args) => {
    const mission = await getMissionOrThrow(ctx, args.missionId);
    return { outcome: await completeMissionTx(ctx, mission) };
  },
});

/** Cancel every in-flight prospect-branch child workflow. */
async function cancelChildWorkflows(
  ctx: MutationCtx,
  missionId: Id<"missions">,
): Promise<void> {
  const branches = await ctx.db
    .query("missionProspects")
    .withIndex("by_missionId_and_prospectId", (q) =>
      q.eq("missionId", missionId),
    )
    .collect();
  for (const branch of branches) {
    if (branch.childWorkflowId === undefined || branch.outcome !== undefined) {
      continue;
    }
    const status = await getStatus(
      ctx,
      components.workflow,
      branch.childWorkflowId as WorkflowId,
    );
    if (status.type === "inProgress") {
      await cancel(
        ctx,
        components.workflow,
        branch.childWorkflowId as WorkflowId,
      );
    }
    await finalizeBranch(ctx, branch, "cancelled", "mission cancelled");
  }
}

/**
 * Shared mission cancel: retire open asks, cancel branch children and the
 * owning workflow, sweep in-flight runs, transition to `cancelled`.
 * Safe to call from `missions.cancel`, the workflow `onComplete` reconcile
 * path, or any future internal trigger — every step is idempotent.
 */
export async function cancelMissionWork(
  ctx: MutationCtx,
  mission: Doc<"missions">,
  actor: string,
): Promise<Doc<"missions">> {
  await retireAllOpenDecisions(ctx, mission._id, "cancelled", actor);
  await cancelChildWorkflows(ctx, mission._id);
  if (mission.workflowId !== undefined) {
    const status = await getStatus(
      ctx,
      components.workflow,
      mission.workflowId as WorkflowId,
    );
    if (status.type === "inProgress") {
      await cancel(ctx, components.workflow, mission.workflowId as WorkflowId);
    }
  }
  await sweepRuns(ctx, mission._id, "cancelled");
  const fresh = await getMissionOrThrow(ctx, mission._id);
  if (fresh.state === "cancelled") {
    return fresh;
  }
  return await transitionMission(ctx, fresh, "cancelled", {
    actor,
    summary: "Mission cancelled",
    patch: { progressSummary: "Cancelled" },
  });
}

/** Shared mission failure: retire asks, sweep runs, land on `failed`. */
export async function failMission(
  ctx: MutationCtx,
  mission: Doc<"missions">,
  message: string,
): Promise<void> {
  const boundedMessage = boundedString(message, "message", {
    min: 1,
    max: 500,
  });
  await retireAllOpenDecisions(ctx, mission._id, "cancelled", "workflow");
  await cancelChildWorkflows(ctx, mission._id);
  await sweepRuns(ctx, mission._id, "failed");
  const fresh = await getMissionOrThrow(ctx, mission._id);
  if (
    fresh.state === "failed" ||
    fresh.state === "cancelled" ||
    fresh.state === "completed"
  ) {
    return;
  }
  await transitionMission(ctx, fresh, "failed", {
    actor: "workflow",
    kind: "mission_failed",
    summary: `Mission failed: ${boundedMessage}`,
    patch: {
      progressSummary: `Failed — ${boundedMessage}`,
      failure: { message: boundedMessage, at: Date.now() },
    },
  });
}

/**
 * Workflow completion reconcile — the mission record is the source of truth;
 * the handler's own steps normally leave it terminal. This callback cleans up
 * the paths the handler can't (step threw → `failed`; `cancel()` →
 * `canceled`).
 */
export const onMissionWorkflowComplete = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: v.object({
      missionId: v.id("missions"),
      workspaceId: v.id("workspaces"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const mission = await ctx.db.get("missions", args.context.missionId);
    if (mission === null || mission.workspaceId !== args.context.workspaceId) {
      return null;
    }
    if (args.result.kind === "success") {
      if (mission.state !== "completed" && mission.state !== "cancelled") {
        await completeMissionTx(ctx, mission);
      }
    } else if (args.result.kind === "failed") {
      await failMission(ctx, mission, args.result.error);
    } else {
      // canceled — only reconcile if the cancel didn't already land.
      if (mission.state !== "cancelled" && mission.state !== "completed") {
        await cancelMissionWork(ctx, mission, "workflow");
      }
    }
    return null;
  },
});

/**
 * Prospect-branch workflow reconcile — guarantees the parent's durable
 * completion event is always delivered with a recorded outcome, even when
 * the child fails or is canceled (the parent aggregates explicit outcomes).
 */
export const onProspectWorkflowComplete = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: v.object({
      branchId: v.id("missionProspects"),
      missionId: v.id("missions"),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const branch = await ctx.db.get("missionProspects", args.context.branchId);
    if (branch === null || branch.outcome !== undefined) {
      return null;
    }
    if (args.result.kind === "success") {
      await finalizeBranch(
        ctx,
        branch,
        "failed",
        "child workflow completed without recording an outcome",
      );
    } else if (args.result.kind === "failed") {
      await finalizeBranch(
        ctx,
        branch,
        "failed",
        args.result.error.slice(0, 300),
      );
    } else {
      await finalizeBranch(ctx, branch, "cancelled", "child workflow canceled");
    }
    return null;
  },
});
