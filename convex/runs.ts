/**
 * Run receipts — architecture §4.2. A run is an execution receipt for one
 * stage attempt, not stage orchestration: Workflow owns ordering/retries,
 * this module owns the durable record (who ran, input version consumed,
 * outcome, usage, error).
 *
 * `beginRun`/`completeRun`/`sweepMissionRuns` are internal — called from
 * workflow steps and mission transitions. `completeRun` is idempotent: a
 * run already in a terminal state keeps its recorded outcome.
 */
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./lib/auth";
import {
  boundedString,
  domainError,
  invalid,
} from "./lib/validators";
import type { RunState } from "./lib/validators";
import { recordActivityEvent } from "./activity";
import type { WriteCtx } from "./activity";
import { runFields } from "./schema";

export const vRunDoc = v.object({
  _id: v.id("runs"),
  _creationTime: v.number(),
  ...runFields,
});

const vRunOutcome = v.union(
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("uncertain"),
);

const TERMINAL_RUN_STATES: readonly RunState[] = [
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
];

/** Shared insert — used by `beginRun` and directly by workflow-step
 *  mutations running inside the workflow's own transaction. */
export async function insertRun(
  ctx: WriteCtx,
  args: {
    missionId: Id<"missions">;
    stage: string;
    generation: number;
    inputVersion: number;
    inputSummary: string;
    employeeId?: Id<"employees">;
    sessionId?: string;
  },
): Promise<Id<"runs">> {
  const mission = await ctx.db.get("missions", args.missionId);
  if (mission === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  const stage = boundedString(args.stage, "stage", { min: 1, max: 64 });
  const inputSummary = boundedString(args.inputSummary, "inputSummary", {
    min: 1,
    max: 500,
  });
  const now = Date.now();
  const runId = await ctx.db.insert("runs", {
    workspaceId: mission.workspaceId,
    missionId: mission._id,
    employeeId: args.employeeId ?? mission.assignedEmployeeId,
    stage,
    generation: args.generation,
    state: "running",
    inputVersion: args.inputVersion,
    inputSummary,
    createdAt: now,
    startedAt: now,
    ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
  });
  await recordActivityEvent(ctx, {
    workspaceId: mission.workspaceId,
    missionId: mission._id,
    kind: "run_started",
    summary: `Run started: ${stage} (generation ${args.generation})`,
    actor: "workflow",
    dedupeKey: `run:${runId}:started`,
    runId,
  });
  return runId;
}

/** Shared terminal transition — idempotent per run. */
export async function finishRun(
  ctx: WriteCtx,
  run: Doc<"runs">,
  outcome: "succeeded" | "failed" | "cancelled" | "uncertain",
  opts?: {
    outputRefs?: string[];
    usage?: { toolCalls?: number; modelCalls?: number; tokens?: number };
    errorMessage?: string;
    retryable?: boolean;
  },
): Promise<void> {
  if (TERMINAL_RUN_STATES.includes(run.state)) {
    return;
  }
  const error =
    outcome === "failed" || outcome === "uncertain"
      ? {
          message: boundedString(
            opts?.errorMessage ?? "unspecified failure",
            "errorMessage",
            { min: 1, max: 500 },
          ),
          ...(opts?.retryable !== undefined ? { retryable: opts.retryable } : {}),
        }
      : undefined;
  await ctx.db.patch("runs", run._id, {
    state: outcome,
    endedAt: Date.now(),
    ...(opts?.outputRefs !== undefined
      ? {
          outputRefs: opts.outputRefs.map((ref, index) =>
            boundedString(ref, `outputRefs[${index}]`, { min: 1, max: 300 }),
          ),
        }
      : {}),
    ...(opts?.usage !== undefined ? { usage: opts.usage } : {}),
    ...(error !== undefined ? { error } : {}),
  });
  await recordActivityEvent(ctx, {
    workspaceId: run.workspaceId,
    missionId: run.missionId,
    kind: outcome === "succeeded" ? "run_completed" : "run_failed",
    summary:
      outcome === "succeeded"
        ? `Run completed: ${run.stage}`
        : `Run ${outcome}: ${run.stage} — ${error?.message ?? ""}`,
    actor: "workflow",
    dedupeKey: `run:${run._id}:${outcome}`,
    runId: run._id,
  });
}

/** Sweep a mission's in-flight runs into a terminal state. Idempotent. */
export async function sweepRuns(
  ctx: WriteCtx,
  missionId: Id<"missions">,
  outcome: "cancelled" | "failed",
): Promise<void> {
  const inFlight = await ctx.db
    .query("runs")
    .withIndex("by_missionId_and_createdAt", (q) =>
      q.eq("missionId", missionId),
    )
    .collect();
  for (const run of inFlight) {
    if (run.state === "pending" || run.state === "running") {
      await ctx.db.patch("runs", run._id, {
        state: outcome,
        endedAt: Date.now(),
        ...(outcome === "failed"
          ? { error: { message: "mission failed while run was in flight" } }
          : {}),
      });
    }
  }
}

/**
 * Insert a running receipt for a stage attempt. `inputVersion` pins the
 * mission-input snapshot version the run consumed; `inputSummary` is a
 * bounded human-readable digest.
 */
export const beginRun = internalMutation({
  args: {
    missionId: v.id("missions"),
    stage: v.string(),
    generation: v.number(),
    inputVersion: v.number(),
    inputSummary: v.string(),
    employeeId: v.optional(v.id("employees")),
    sessionId: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args) => {
    return await insertRun(ctx, args);
  },
});

/**
 * Move a run into a terminal state. Idempotent — a repeated completion keeps
 * the recorded outcome and returns the run unchanged (duplicate worker
 * callbacks are acknowledged no-ops, §6.2).
 */
export const completeRun = internalMutation({
  args: {
    runId: v.id("runs"),
    outcome: vRunOutcome,
    outputRefs: v.optional(v.array(v.string())),
    usage: v.optional(
      v.object({
        toolCalls: v.optional(v.number()),
        modelCalls: v.optional(v.number()),
        tokens: v.optional(v.number()),
      }),
    ),
    errorMessage: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  returns: vRunDoc,
  handler: async (ctx, args) => {
    const run = await ctx.db.get("runs", args.runId);
    if (run === null) {
      throw domainError("NOT_FOUND", "run not found");
    }
    await finishRun(ctx, run, args.outcome, {
      outputRefs: args.outputRefs,
      usage: args.usage,
      errorMessage: args.errorMessage,
      retryable: args.retryable,
    });
    const updated = await ctx.db.get("runs", run._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "run not found");
    }
    return updated;
  },
});

/**
 * Sweep a mission's in-flight runs into `cancelled`/`failed` when the mission
 * terminates. Idempotent per run.
 */
export const sweepMissionRuns = internalMutation({
  args: {
    missionId: v.id("missions"),
    outcome: v.union(v.literal("cancelled"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sweepRuns(ctx, args.missionId, args.outcome);
    return null;
  },
});

/** One run receipt; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    runId: v.id("runs"),
  },
  returns: vRunDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const run = await ctx.db.get("runs", args.runId);
    if (run === null || run.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "run not found");
    }
    return run;
  },
});

/** Guard helper for callers that validate run payloads by state. */
export function assertRunState(run: Doc<"runs">, states: RunState[]): void {
  if (!states.includes(run.state)) {
    throw invalid(`run is ${run.state}; expected ${states.join("|")}`);
  }
}
