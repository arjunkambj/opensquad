/**
 * Decisions — required human asks (architecture §4.2/§5/§6.2).
 *
 * A decision binds three things at creation, all assigned by the backend and
 * never trusted from a callback payload: the workflow that is waiting
 * (`targetWorkflowId`), the durable event that wakes it
 * (`continuationEventId`) and the mission's `workflowGeneration` — a stale
 * event can never advance a newer generation.
 *
 * `resolve` is the only way a human answer lands: expectedVersion optimistic
 * concurrency + requestId dedupe + exactly one open required decision per
 * semantic `askKey`. The continuation signal is delivered in the SAME
 * transaction as the resolution write (`sendEvent` composes transactionally
 * via `ctx.runMutation`), and `continuationSentAt` + the recorded
 * `continuationEventId` make delivery recoverable if it ever needs a replay.
 *
 * A `missionComment` has no path into this file — comments cannot resolve a
 * business approval.
 */
import { createEvent, sendEvent } from "@convex-dev/workflow";
import type { EventId, WorkflowId } from "@convex-dev/workflow";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import {
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  assertDecisionAnswer,
  boardColumnForMission,
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  vDecisionAnswer,
  vDecisionKind,
} from "./lib/validators";
import type { DecisionAnswer } from "./lib/validators";
import { recordActivityEvent } from "./activity";
import type { WriteCtx } from "./activity";
import { decisionFields } from "./schema";

export const vDecisionDoc = v.object({
  _id: v.id("decisions"),
  _creationTime: v.number(),
  ...decisionFields,
});

/**
 * The continuation payload delivered to the waiting workflow. The workflow
 * treats it as a hint only — the continuation step re-reads the decision row
 * and applies the recorded resolution, so a replayed or stale signal can
 * never inject a different answer.
 */
export const vDecisionContinuation = v.object({
  decisionId: v.id("decisions"),
  /** Decision row version after resolution. */
  version: v.number(),
  resolvedBy: v.string(),
  resolvedAt: v.number(),
  answer: vDecisionAnswer,
});

export type DecisionContinuation = Infer<typeof vDecisionContinuation>;

/** Errors raised by the component when an event was already delivered. */
function isAlreadyDelivered(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Event already sent") ||
    message.includes("Event already consumed")
  );
}

async function getMissionInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  missionId: Id<"missions">,
): Promise<Doc<"missions">> {
  const mission = await ctx.db.get("missions", missionId);
  if (mission === null || mission.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  return mission;
}

async function getDecisionInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
  decisionId: Id<"decisions">,
): Promise<Doc<"decisions">> {
  const decision = await ctx.db.get("decisions", decisionId);
  if (decision === null || decision.workspaceId !== workspaceId) {
    throw domainError("NOT_FOUND", "decision not found");
  }
  return decision;
}

/**
 * Adjust a mission's open-ask bookkeeping after a decision leaves `open`:
 * decrements `requiredDecisionCount` for required asks and recomputes
 * state/board column. When the last required ask closes and the mission was
 * parked on it, the mission returns to `active` — the workflow still owns
 * what happens next.
 */
async function closeAskOnMission(
  ctx: WriteCtx,
  mission: Doc<"missions">,
  decision: Doc<"decisions">,
): Promise<void> {
  const requiredDecisionCount = Math.max(
    0,
    mission.requiredDecisionCount - (decision.required ? 1 : 0),
  );
  let state = mission.state;
  if (state === "waiting_for_user" && requiredDecisionCount === 0) {
    state = "active";
  }
  await ctx.db.patch("missions", mission._id, {
    state,
    boardColumn: boardColumnForMission(state, requiredDecisionCount),
    requiredDecisionCount,
    version: mission.version + 1,
    updatedAt: Date.now(),
  });
}

/**
 * Deliver the recorded resolution to the waiting workflow exactly once.
 * Transactional: called inside the resolving mutation, so the signal and the
 * answer commit together. A duplicate call is safe — the component rejects
 * re-sends to a sent/consumed event, which we fold into `continuationSentAt`.
 */
async function deliverDecisionContinuation(
  ctx: MutationCtx,
  decision: Doc<"decisions">,
  continuation: DecisionContinuation,
): Promise<boolean> {
  try {
    await sendEvent(ctx, components.workflow, {
      id: decision.continuationEventId as EventId,
      validator: vDecisionContinuation,
      value: continuation,
    });
  } catch (error) {
    if (!isAlreadyDelivered(error)) {
      throw error;
    }
  }
  return true;
}

/**
 * Mark an open decision `superseded`/`cancelled`, adjust the mission and wake
 * a waiting workflow with an error on its continuation event so it can
 * re-check state instead of hanging on a stale ask (§6.2).
 */
async function retireDecision(
  ctx: MutationCtx,
  decision: Doc<"decisions">,
  to: "superseded" | "cancelled",
  actor: string,
): Promise<void> {
  if (decision.state !== "open") {
    return;
  }
  const mission = await ctx.db.get("missions", decision.missionId);
  await ctx.db.patch("decisions", decision._id, {
    state: to,
    version: decision.version + 1,
    updatedAt: Date.now(),
  });
  if (mission !== null) {
    await closeAskOnMission(ctx, mission, decision);
  }
  await recordActivityEvent(ctx, {
    workspaceId: decision.workspaceId,
    missionId: decision.missionId,
    kind: to === "superseded" ? "decision_superseded" : "decision_cancelled",
    summary:
      to === "superseded"
        ? `Decision superseded: ${decision.reason}`
        : `Decision cancelled: ${decision.reason}`,
    actor,
    dedupeKey: `decision:${decision._id}:${to}`,
  });
  // Wake the waiting workflow so a parked await re-checks mission state.
  // A dead workflow never consumes the event — harmless either way.
  try {
    await sendEvent(ctx, components.workflow, {
      id: decision.continuationEventId as EventId,
      error: `decision ${to}`,
    });
  } catch (error) {
    if (!isAlreadyDelivered(error)) {
      throw error;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Internal write path (workflow steps and future modules)             */
/* ------------------------------------------------------------------ */

/**
 * Open a required (or advisory) ask for a mission. Idempotent per semantic
 * ask: an existing OPEN decision with the same `askKey` is returned instead
 * of creating a duplicate (§4.2 invariant).
 *
 * The continuation event is created here on `targetWorkflowId` — which must
 * be the mission's own workflow or a workflow owned by one of its prospect
 * branches — so the recorded event ID is always backend-assigned.
 */
export const openRequiredDecision = internalMutation({
  args: {
    missionId: v.id("missions"),
    kind: vDecisionKind,
    reason: v.string(),
    /** Semantic ask identity, e.g. `draft_approval:<draftId>` or
     *  `missing_information:<topic>`. */
    askKey: v.string(),
    required: v.boolean(),
    requestedFields: v.optional(v.array(v.string())),
    draftId: v.optional(v.string()),
    sendAttemptId: v.optional(v.string()),
    targetWorkflowId: v.string(),
  },
  returns: v.object({
    decisionId: v.id("decisions"),
    continuationEventId: v.string(),
    alreadyOpen: v.boolean(),
    workflowGeneration: v.number(),
  }),
  handler: async (ctx, args) => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    if (
      mission.state === "completed" ||
      mission.state === "cancelled" ||
      mission.state === "failed"
    ) {
      throw domainError(
        "CONFLICT",
        `mission is ${mission.state}; cannot open a decision`,
      );
    }
    if (mission.workflowId === undefined) {
      throw invalid("mission has no dispatched workflow to signal");
    }
    // The ask may only bind a workflow this mission owns: the mission's own
    // workflow or a registered prospect-branch child.
    if (args.targetWorkflowId !== mission.workflowId) {
      const branch = await ctx.db
        .query("missionProspects")
        .withIndex("by_childWorkflowId", (q) =>
          q.eq("childWorkflowId", args.targetWorkflowId),
        )
        .unique();
      if (branch === null || branch.missionId !== mission._id) {
        throw invalid("targetWorkflowId is not owned by this mission");
      }
    }

    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: 1000,
    });
    const askKey = boundedString(args.askKey, "askKey", {
      min: 1,
      max: 200,
    });

    // One open required decision per semantic ask (§4.2).
    const open = await ctx.db
      .query("decisions")
      .withIndex("by_missionId_and_state", (q) =>
        q.eq("missionId", mission._id).eq("state", "open"),
      )
      .collect();
    const existing = open.find((decision) => decision.askKey === askKey);
    if (existing !== null && existing !== undefined) {
      return {
        decisionId: existing._id,
        continuationEventId: existing.continuationEventId,
        alreadyOpen: true,
        workflowGeneration: existing.workflowGeneration,
      };
    }

    const continuationEventId = await createEvent(ctx, components.workflow, {
      name: `decision:${askKey}`,
      workflowId: args.targetWorkflowId as WorkflowId,
    });

    const now = Date.now();
    const decisionId = await ctx.db.insert("decisions", {
      workspaceId: mission.workspaceId,
      missionId: mission._id,
      kind: args.kind,
      state: "open",
      version: 1,
      required: args.required,
      reason,
      askKey,
      createdAt: now,
      updatedAt: now,
      targetWorkflowId: args.targetWorkflowId,
      continuationEventId,
      workflowGeneration: mission.workflowGeneration,
      ...(args.draftId !== undefined ? { draftId: args.draftId } : {}),
      ...(args.sendAttemptId !== undefined
        ? { sendAttemptId: args.sendAttemptId }
        : {}),
      ...(args.requestedFields !== undefined
        ? {
            requestedFields: args.requestedFields.map((field, index) =>
              boundedString(field, `requestedFields[${index}]`, {
                min: 1,
                max: 100,
              }),
            ),
          }
        : {}),
    });

    if (args.required) {
      const requiredDecisionCount = mission.requiredDecisionCount + 1;
      await ctx.db.patch("missions", mission._id, {
        requiredDecisionCount,
        boardColumn: boardColumnForMission(
          mission.state,
          requiredDecisionCount,
        ),
        version: mission.version + 1,
        updatedAt: now,
      });
    }

    await recordActivityEvent(ctx, {
      workspaceId: mission.workspaceId,
      missionId: mission._id,
      kind: "decision_opened",
      summary: `${args.kind} ask opened: ${reason}`,
      actor: "workflow",
      dedupeKey: `decision:${decisionId}:opened`,
    });

    return {
      decisionId,
      continuationEventId,
      alreadyOpen: false,
      workflowGeneration: mission.workflowGeneration,
    };
  },
});

/**
 * Supersede one open decision (a newer ask replaced it — e.g. a revised
 * draft in P10). Wakes the waiting workflow with an error so it re-checks
 * state rather than hanging on the stale ask.
 */
export const supersedeDecision = internalMutation({
  args: {
    decisionId: v.id("decisions"),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const decision = await ctx.db.get("decisions", args.decisionId);
    if (decision === null) {
      throw domainError("NOT_FOUND", "decision not found");
    }
    await retireDecision(ctx, decision, "superseded", "workflow");
    return null;
  },
});

/**
 * Retire every open decision on a mission — shared by the mission
 * cancel/fail paths and callable directly inside a larger transaction.
 */
export async function retireAllOpenDecisions(
  ctx: MutationCtx,
  missionId: Id<"missions">,
  to: "superseded" | "cancelled",
  actor: string,
): Promise<void> {
  const open = await ctx.db
    .query("decisions")
    .withIndex("by_missionId_and_state", (q) =>
      q.eq("missionId", missionId).eq("state", "open"),
    )
    .collect();
  for (const decision of open) {
    await retireDecision(ctx, decision, to, actor);
  }
}

/**
 * Repair path — re-deliver a recorded resolution's continuation signal when
 * `continuationSentAt` is absent. `resolve` sends transactionally, so this
 * only ever matters if a future change separates the two; it is idempotent
 * either way (the component rejects re-sends to a delivered event).
 */
export const redeliverContinuation = internalMutation({
  args: { decisionId: v.id("decisions") },
  returns: v.object({ delivered: v.boolean() }),
  handler: async (ctx, args) => {
    const decision = await ctx.db.get("decisions", args.decisionId);
    if (decision === null) {
      throw domainError("NOT_FOUND", "decision not found");
    }
    if (decision.state !== "resolved" || decision.answer === undefined) {
      return { delivered: false };
    }
    if (decision.continuationSentAt !== undefined) {
      return { delivered: true };
    }
    await deliverDecisionContinuation(ctx, decision, {
      decisionId: decision._id,
      version: decision.version,
      resolvedBy: decision.resolvedBy ?? "unknown",
      resolvedAt: decision.resolvedAt ?? decision.updatedAt,
      answer: decision.answer,
    });
    await ctx.db.patch("decisions", decision._id, {
      continuationSentAt: Date.now(),
    });
    return { delivered: true };
  },
});

/**
 * Cancel every open decision on a mission (mission cancel/fail path).
 * Counts are recomputed per decision by `retireDecision`.
 */
export const cancelMissionDecisions = internalMutation({
  args: { missionId: v.id("missions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await retireAllOpenDecisions(ctx, args.missionId, "cancelled", "workflow");
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Public reads                                                         */
/* ------------------------------------------------------------------ */

/**
 * Open decisions for the workspace (the shared decision queue), optionally
 * scoped to one mission. Newest first, cursor-paginated.
 */
export const listOpen = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.optional(v.id("missions")),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vDecisionDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    if (args.missionId !== undefined) {
      await getMissionInWorkspace(ctx, args.workspaceId, args.missionId);
    }
    const limit = boundedLimit(args.limit);
    const result =
      args.missionId === undefined
        ? await ctx.db
            .query("decisions")
            .withIndex("by_workspaceId_and_state_and_createdAt", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("state", "open"),
            )
            .order("desc")
            .paginate({ numItems: limit, cursor: args.cursor ?? null })
        : await ctx.db
            .query("decisions")
            .withIndex("by_missionId_and_state", (q) =>
              q.eq("missionId", args.missionId!).eq("state", "open"),
            )
            .order("desc")
            .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/** All decisions for a mission, newest first — the ask history. */
export const listForMission = query({
  args: {
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vDecisionDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    await getMissionInWorkspace(ctx, args.workspaceId, args.missionId);
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("decisions")
      .withIndex("by_missionId_and_createdAt", (q) =>
        q.eq("missionId", args.missionId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/** One decision; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
  },
  returns: vDecisionDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await getDecisionInWorkspace(ctx, args.workspaceId, args.decisionId);
  },
});

/* ------------------------------------------------------------------ */
/* Public mutations                                                     */
/* ------------------------------------------------------------------ */

/**
 * Record the human answer to an open ask (owner/operator).
 *
 * - `expectedVersion` — optimistic concurrency; a stale client gets
 *   `CONFLICT` with the current version.
 * - `requestId` — idempotency key: replaying a committed resolve returns the
 *   recorded decision unchanged.
 * - Two concurrent resolves: Convex serializes the conflicting transaction —
 *   the loser replays, observes `state !== "open"` and gets `CONFLICT` (or the
 *   recorded outcome when it carried the same `requestId`).
 * - The continuation signal is sent transactionally with the resolution, so
 *   "answer persisted but signal lost" cannot happen; `continuationSentAt`
 *   records delivery.
 * - A decision bound to an older `workflowGeneration` still records the
 *   answer, but the workflow-side continuation step validates generation and
 *   recorded state before applying it — a stale signal never advances.
 *
 * Generic asks (`missing_information`, `connection_required`) resolve here;
 * `draft_approval` and `delivery_uncertain` are refused — their resolution
 * owns an artifact (the approvals row, the §8.7 covering authorization) that
 * only `approvals.*` / `sending.resolveDeliveryUncertainty` can produce.
 */
/**
 * Shared resolution write path — used by the public `resolve` for generic
 * asks and by `resolveBound` for kinds whose resolution ceremony lives in a
 * dedicated mutation (`approvals.*` writes the approvals row,
 * `sending.resolveDeliveryUncertainty` writes the covering authorization).
 * Callers authenticate and pass `identityKey` through; every guard here
 * (replay, state, version, kind minimums) re-runs regardless of entry point.
 */
async function applyResolution(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    decisionId: Id<"decisions">;
    expectedVersion: number;
    requestId: string;
    answer: DecisionAnswer;
    resolvedBy: string;
  },
): Promise<Doc<"decisions">> {
  const requestId = boundedString(args.requestId, "requestId", {
    min: 1,
    max: 100,
  });
  assertDecisionAnswer(args.answer);
  const identityKey = args.resolvedBy;

  const decision = await getDecisionInWorkspace(
    ctx,
    args.workspaceId,
    args.decisionId,
  );

  // Idempotent replay of a committed resolution.
  if (
    decision.state === "resolved" &&
    decision.resolutionRequestId === requestId
  ) {
    return decision;
  }
  if (decision.state !== "open") {
    throw domainError(
      "CONFLICT",
      `decision is ${decision.state}; it is no longer open`,
    );
  }
  if (decision.version !== args.expectedVersion) {
    throw domainError(
      "CONFLICT",
      `decision version is ${decision.version}, not ${args.expectedVersion}`,
    );
  }

  // Kind-specific minimums — exact draft/revision binding lands in P10.
  if (decision.kind === "draft_approval" && args.answer.approved === undefined) {
    throw invalid("draft_approval decisions require answer.approved");
  }
  if (
    decision.kind === "missing_information" &&
    args.answer.fields === undefined &&
    args.answer.body === undefined
  ) {
    throw invalid("missing_information decisions require fields or a body");
  }

  const mission = await getMissionInWorkspace(
    ctx,
    args.workspaceId,
    decision.missionId,
  );

  const now = Date.now();
  const nextVersion = decision.version + 1;
  await ctx.db.patch("decisions", decision._id, {
    state: "resolved",
    version: nextVersion,
    answer: args.answer,
    resolvedBy: identityKey,
    resolvedAt: now,
    resolutionRequestId: requestId,
    updatedAt: now,
  });

  if (decision.required) {
    await closeAskOnMission(ctx, mission, decision);
  } else {
    await ctx.db.patch("missions", mission._id, { updatedAt: now });
  }

  await recordActivityEvent(ctx, {
    workspaceId: args.workspaceId,
    missionId: mission._id,
    kind: "decision_resolved",
    summary: `Decision resolved: ${decision.reason}`,
    actor: identityKey,
    dedupeKey: `decision:${decision._id}:resolved`,
  });

  // Durable continuation signal — transactional with the resolution. If the
  // mission's workflow generation moved on, the signal still lands on the
  // recorded event but the continuation step ignores it.
  await deliverDecisionContinuation(ctx, decision, {
    decisionId: decision._id,
    version: nextVersion,
    resolvedBy: identityKey,
    resolvedAt: now,
    answer: args.answer,
  });
  await ctx.db.patch("decisions", decision._id, {
    continuationSentAt: Date.now(),
  });
  await recordActivityEvent(ctx, {
    workspaceId: args.workspaceId,
    missionId: mission._id,
    kind: "continuation_delivered",
    summary: `Continuation signal delivered for ${decision.kind}`,
    actor: "system",
    dedupeKey: `decision:${decision._id}:continuation`,
  });

  const updated = await ctx.db.get("decisions", decision._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "decision not found");
  }
  return updated;
}

export const resolve = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
    expectedVersion: v.number(),
    requestId: v.string(),
    answer: vDecisionAnswer,
  },
  returns: vDecisionDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const decision = await getDecisionInWorkspace(
      ctx,
      args.workspaceId,
      args.decisionId,
    );
    // Artifact-bound kinds must resolve through their owning mutation:
    // `draft_approval` needs the immutable approvals row written by
    // `approvals.*` (the send boundary accepts no other artifact) and
    // `delivery_uncertain` needs the §8.7 validations in
    // `sending.resolveDeliveryUncertainty`. A bare answer here would burn
    // the ask while recording a resolution no downstream gate honors —
    // the bound revision could never gain an approval again.
    if (decision.kind === "draft_approval") {
      throw invalid(
        "draft_approval decisions resolve through approvals.approve/requestChanges/reject",
      );
    }
    if (decision.kind === "delivery_uncertain") {
      throw invalid(
        "delivery_uncertain decisions resolve through sending.resolveDeliveryUncertainty",
      );
    }
    return await applyResolution(ctx, { ...args, resolvedBy: identityKey });
  },
});

/**
 * Resolution entry for the owning mutations — identical guards and write
 * path as `resolve`, but reachable only from backend callers that already
 * authenticated the reviewer and produced the kind's required artifact.
 */
export const resolveBound = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    decisionId: v.id("decisions"),
    expectedVersion: v.number(),
    requestId: v.string(),
    answer: vDecisionAnswer,
    resolvedBy: v.string(),
  },
  returns: vDecisionDoc,
  handler: async (ctx, args) => {
    const resolvedBy = boundedString(args.resolvedBy, "resolvedBy", {
      min: 1,
      max: 100,
    });
    return await applyResolution(ctx, { ...args, resolvedBy });
  },
});
