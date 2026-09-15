/**
 * Worker operations — the workflow-facing external-step adapter (P07).
 *
 * This module is the seam between durable Workflow steps and the
 * `/worker/*` transport: a step calls `dispatchWorkerRequest`, which binds
 * the request to the step's run receipt, the mission's workflow generation
 * and a backend-created continuation event. The worker bridge (transport)
 * only ever touches request/lease/slot state; the workflow then awaits the
 * recorded event and re-reads the request row — Workflow stays the sole
 * owner of stage ordering, retries and durable waits.
 *
 * Also here: the lease/control/challenge sweeper (self-scheduled by the
 * bridge so no crons.ts edit is needed) and clearly-marked developer-only
 * seeding/fault helpers used to exercise the bridge on isolated
 * deployments. None of these are reachable from clients or HTTP routes.
 */
import { createEvent, sendEvent, start } from "@convex-dev/workflow";
import type { EventId, WorkflowId } from "@convex-dev/workflow";
import { internalMutation, internalQuery } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { insertRun, finishRun } from "./runs";
import {
  assertWorkerRequestInput,
  boundedInt,
  boundedString,
  CAMPAIGN_LEAD_LIMIT_MIN,
  CAMPAIGN_LEAD_LIMIT_MAX,
  deriveRequestCapabilities,
  intersectCapabilities,
  localDayKey,
  modelRunOperationKey,
  MODEL_RUN_DAILY_LIMIT_DEFAULT,
  vCapabilityId,
  HOST_CAPABILITY_POLICY,
  bridgeError,
  bridgeInvalid,
  domainError,
  mintBridgeRequestId,
  mintWorkerToken,
  sha256Hex,
  vWorkerOperation,
  vWorkerRequestCompletion,
  WORKER_CREDENTIAL_TTL_MS,
  WORKER_INPUT_SCHEMA_VERSION,
  CONTROL_REQUEST_TTL_MS,
} from "./lib/validators";
import type { EmployeeTemplate, WorkerOperation } from "./lib/validators";
import type { MutationCtx } from "./_generated/server";

/* ------------------------------------------------------------------ */
/* Dispatch — called by workflow steps (and the dev seeder)              */
/* ------------------------------------------------------------------ */

/**
 * Runtime-connection states a dispatch may be created against. Exported so a
 * workflow step can ask the question BEFORE calling `dispatchWorkerRequest`:
 * a `ctx.runMutation` throw inside a mutation shares the caller's
 * transaction, so a step that wants to park and retry instead of failing must
 * pre-check rather than catch. One definition, so the pre-check and the
 * dispatch can never disagree about what "dispatchable" means.
 */
export const DISPATCHABLE_RUNTIME_STATES: ReadonlySet<string> = new Set([
  "provisioning",
  "connecting",
  "ready",
]);

/**
 * Settle the model-run debit a dispatch took for this request.
 *
 * Every terminal transition calls this, and it asks before it settles: a
 * request dispatched before the debit existed has no reservation, and
 * `usage.commit` on a missing one would throw NOT_FOUND inside the caller's
 * transaction and roll back the terminal write itself. A nested mutation's
 * error cannot be caught, so the check has to come first.
 *
 * `markUncertain` keeps capacity blocked on purpose. A run whose outcome we
 * cannot prove is spend we cannot prove we did not incur.
 */
export async function settleModelRun(
  ctx: MutationCtx,
  request: Doc<"workerRequests">,
  target: "commit" | "release" | "markUncertain",
): Promise<void> {
  const operationKey = modelRunOperationKey(request);
  const reservation = await ctx.runMutation(internal.usage.getByOperationKey, {
    workspaceId: request.workspaceId,
    operationKey,
  });
  if (reservation === null) {
    return;
  }
  if (target === "commit") {
    if (reservation.state !== "reserved" && reservation.state !== "uncertain") {
      return;
    }
    await ctx.runMutation(internal.usage.commit, {
      workspaceId: request.workspaceId,
      operationKey,
    });
    return;
  }
  if (target === "release") {
    if (reservation.state !== "reserved" && reservation.state !== "uncertain") {
      return;
    }
    await ctx.runMutation(internal.usage.release, {
      workspaceId: request.workspaceId,
      operationKey,
    });
    return;
  }
  if (reservation.state !== "reserved") {
    return;
  }
  await ctx.runMutation(internal.usage.markUncertain, {
    workspaceId: request.workspaceId,
    operationKey,
  });
}

/**
 * Create a bounded external worker request for a workflow step. Idempotent
 * per (missionId, stepKey, generation): a replayed step reuses the existing
 * request AND its continuation event, so a backend restart never double-
 * dispatches model work.
 *
 * The `continuationEventId` is created on `targetWorkflowId` here — the
 * workflow then `awaitEvent`s it. The bridge delivers the completion into
 * that event (transactional with the state write), so a parked step wakes
 * exactly once per attempt.
 */
export const dispatchWorkerRequest = internalMutation({
  args: {
    missionId: v.id("missions"),
    runId: v.id("runs"),
    stepKey: v.string(),
    generation: v.number(),
    operation: vWorkerOperation,
    input: v.any(),
    outputSchemaVersion: v.number(),
    targetWorkflowId: v.string(),
    workflowGeneration: v.number(),
  },
  returns: v.object({
    workerRequestId: v.id("workerRequests"),
    continuationEventId: v.string(),
    alreadyExists: v.boolean(),
    state: v.string(),
  }),
  handler: async (ctx, args) => await dispatchWorkerRequestImpl(ctx, args),
});

/** The arguments of the ONE dispatch path. */
type DispatchWorkerRequestArgs = {
  missionId: Id<"missions">;
  runId: Id<"runs">;
  stepKey: string;
  generation: number;
  operation: WorkerOperation;
  input: unknown;
  outputSchemaVersion: number;
  targetWorkflowId: string;
  workflowGeneration: number;
};

/**
 * The single dispatch implementation. It used to have a private twin that
 * the dev seeders called, which skipped the `targetWorkflowId` ownership,
 * `workflowGeneration`, terminal-mission and `outputSchemaVersion` checks —
 * two paths that were already drifting and would have drifted again the
 * moment capabilities and budgets landed on one of them. There is now one.
 */
async function dispatchWorkerRequestImpl(
  ctx: MutationCtx,
  args: DispatchWorkerRequestArgs,
): Promise<{
  workerRequestId: Id<"workerRequests">;
  continuationEventId: string;
  alreadyExists: boolean;
  state: string;
}> {
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
        `mission is ${mission.state}; cannot dispatch worker work`,
      );
    }
    if (mission.workflowId === undefined) {
      throw bridgeInvalid("mission has no dispatched workflow to signal");
    }
    // The continuation event may only bind a workflow this mission owns —
    // its own workflow or a registered prospect-branch child (same rule as
    // openRequiredDecision): a misbound target would complete the real
    // workflow's step yet never re-enqueue it, parking the mission forever.
    if (args.targetWorkflowId !== mission.workflowId) {
      const branch = await ctx.db
        .query("missionProspects")
        .withIndex("by_childWorkflowId", (q) =>
          q.eq("childWorkflowId", args.targetWorkflowId),
        )
        .unique();
      if (branch === null || branch.missionId !== mission._id) {
        throw bridgeInvalid("targetWorkflowId is not owned by this mission");
      }
    }
    if (args.workflowGeneration !== mission.workflowGeneration) {
      throw domainError(
        "CONFLICT",
        `workflowGeneration is ${mission.workflowGeneration}, not ${args.workflowGeneration}`,
      );
    }
    const stepKey = boundedString(args.stepKey, "stepKey", {
      min: 1,
      max: 200,
    });
    if (!Number.isSafeInteger(args.generation) || args.generation < 1) {
      throw bridgeInvalid("generation must be a positive integer");
    }
    if (args.outputSchemaVersion !== WORKER_INPUT_SCHEMA_VERSION) {
      throw bridgeInvalid("outputSchemaVersion must be 1");
    }
    // The capability set is DERIVED, never supplied: a caller that could
    // name its own capabilities is exactly the model-supplied request the
    // card forbids. `assertWorkerRequestInput` accepts the key so the stored
    // envelope can carry the backend's own mirror; the field is refused here,
    // on the way in.
    if (
      typeof args.input === "object" &&
      args.input !== null &&
      (args.input as Record<string, unknown>)["capabilities"] !== undefined
    ) {
      throw bridgeInvalid(
        "input.capabilities is derived at dispatch, not supplied by the caller",
      );
    }
    assertWorkerRequestInput(args.input);

    const existing = await ctx.db
      .query("workerRequests")
      .withIndex("by_missionId_and_stepKey_and_generation", (q) =>
        q
          .eq("missionId", args.missionId)
          .eq("stepKey", stepKey)
          .eq("generation", args.generation),
      )
      .unique();
    if (existing !== null) {
      return {
        workerRequestId: existing._id,
        continuationEventId: existing.continuationEventId,
        alreadyExists: true,
        state: existing.state,
      };
    }

    const connection = await ctx.db
      .query("runtimeConnections")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", mission.workspaceId))
      .unique();
    if (connection === null) {
      throw domainError(
        "CONFLICT",
        "workspace has no runtime connection — connect one before dispatching model work",
      );
    }
    if (!DISPATCHABLE_RUNTIME_STATES.has(connection.state)) {
      throw domainError(
        "CONFLICT",
        `runtime connection is ${connection.state}; worker work cannot be dispatched`,
      );
    }
    const run = await ctx.db.get("runs", args.runId);
    if (run === null || run.missionId !== mission._id) {
      throw domainError("NOT_FOUND", "run not found for mission");
    }

    // The issued capability set comes from the run's OWN employee row, read
    // here and narrowed by the host policy for its template. `run.employeeId`
    // is a required column (insertRun defaults it to the mission's assigned
    // employee), so there is always exactly one employee to ask.
    const employee = await ctx.db.get("employees", run.employeeId);
    if (employee === null || employee.workspaceId !== mission.workspaceId) {
      throw domainError("NOT_FOUND", "run employee not found");
    }
    if (!employee.enabled) {
      throw domainError(
        "CONFLICT",
        `employee ${employee.template} is disabled`,
      );
    }
    const capabilities = deriveRequestCapabilities(
      employee.template,
      employee.allowedCapabilities,
      args.operation,
    );
    // Mirror into the envelope the worker receives, then re-validate: the
    // stored `inputRef.value` is exactly what the asserter accepts, mirror
    // included, and can never exceed the envelope bound by a field the
    // backend itself added.
    const input = {
      ...(args.input as Record<string, unknown>),
      capabilities,
    };
    assertWorkerRequestInput(input);

    // The model-run debit is taken HERE: after the `alreadyExists` early
    // return (a replayed step must never debit twice) and before anything is
    // written, so a workspace over its daily ceiling aborts this whole
    // transaction with no request row, no continuation event and no claimable
    // work. It is deliberately not taken in `claimWork`, which must throw
    // before any state mutation — a reservation conflict placed after the
    // lease and slot patches would leave a leased request holding a slot the
    // worker never received.
    const workspace = await ctx.db.get("workspaces", mission.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found for mission");
    }
    await ctx.runMutation(internal.usage.reserve, {
      workspaceId: mission.workspaceId,
      scopeKey: "workspace",
      metric: "model_runs" as const,
      periodKey: localDayKey(Date.now(), workspace.timezone),
      limit: workspace.modelRunDailyLimit ?? MODEL_RUN_DAILY_LIMIT_DEFAULT,
      operationKey: modelRunOperationKey({
        missionId: args.missionId,
        stepKey,
        generation: args.generation,
      }),
      quantity: 1,
    });

    const continuationEventId = await createEvent(ctx, components.workflow, {
      name: `worker:${args.operation}:${stepKey}`,
      workflowId: args.targetWorkflowId as WorkflowId,
    });

    const now = Date.now();
    const workerRequestId = await ctx.db.insert("workerRequests", {
      workspaceId: mission.workspaceId,
      runtimeConnectionId: connection._id,
      runtimeGeneration: connection.generation,
      missionId: mission._id,
      runId: args.runId,
      stepKey,
      generation: args.generation,
      operation: args.operation,
      state: "pending",
      inputRef: { kind: "inline", value: input },
      capabilities,
      outputSchemaVersion: args.outputSchemaVersion,
      targetWorkflowId: args.targetWorkflowId,
      continuationEventId,
      workflowGeneration: args.workflowGeneration,
      createdAt: now,
      updatedAt: now,
    });
    return {
      workerRequestId,
      continuationEventId,
      alreadyExists: false,
      state: "pending",
    };
}

/** Read back a dispatched request — the continuation step calls this after
 *  its awaited event fires (or errors) to apply the recorded outcome. */
export const readWorkerRequest = internalQuery({
  args: { workerRequestId: v.id("workerRequests") },
  returns: v.union(
    v.object({
      found: v.literal(true),
      state: v.string(),
      operation: v.string(),
      result: v.optional(v.any()),
      error: v.optional(v.any()),
      missionId: v.id("missions"),
      runId: v.id("runs"),
      generation: v.number(),
      workflowGeneration: v.number(),
    }),
    v.object({ found: v.literal(false) }),
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("workerRequests", args.workerRequestId);
    if (request === null) {
      return { found: false as const };
    }
    return {
      found: true as const,
      state: request.state,
      operation: request.operation,
      ...(request.resultRef?.kind === "inline"
        ? { result: request.resultRef.value }
        : {}),
      ...(request.error !== undefined ? { error: request.error } : {}),
      missionId: request.missionId,
      runId: request.runId,
      generation: request.generation,
      workflowGeneration: request.workflowGeneration,
    };
  },
});

/**
 * Cancel every non-terminal worker request for a mission — used by the
 * sweep and callable from mission-termination or runtime-retirement
 * plumbing. Leased/running rows move to `cancelled`; the worker is ordered
 * to stop at its next heartbeat; each cancellation finishes the run receipt
 * AND signals the awaiting workflow's continuation event — a request
 * cancelled without its event would park the workflow step forever.
 */
export async function cancelMissionWorkerRequests(
  ctx: MutationCtx,
  missionId: Id<"missions">,
  reason?: { code: string; detail: string },
): Promise<number> {
  const code = reason?.code ?? "mission_cancelled";
  const detail = reason?.detail ?? "mission terminated";
  const rows = await ctx.db
    .query("workerRequests")
    .withIndex("by_missionId_and_stepKey_and_generation", (q) =>
      q.eq("missionId", missionId),
    )
    .collect();
  let cancelled = 0;
  for (const request of rows) {
    if (
      request.state === "pending" ||
      request.state === "leased" ||
      request.state === "running"
    ) {
      await ctx.db.patch("workerRequests", request._id, {
        state: "cancelled",
        error: { code, message: detail },
        updatedAt: Date.now(),
      });
      cancelled += 1;
      // Cancelled before any model work could run — the debit is released.
      await settleModelRun(ctx, request, "release");
      const run = await ctx.db.get("runs", request.runId);
      if (run !== null) {
        await finishRun(ctx, run, "cancelled", {
          errorMessage: detail,
        });
      }
      await deliverCompletionSafe(ctx, request, "cancelled", detail);
    }
  }
  return cancelled;
}

async function deliverCompletionSafe(
  ctx: MutationCtx,
  request: Doc<"workerRequests">,
  outcome: "succeeded" | "failed" | "cancelled" | "uncertain",
  detail: string,
): Promise<void> {
  try {
    await sendEvent(ctx, components.workflow, {
      id: request.continuationEventId as EventId,
      validator: vWorkerRequestCompletion,
      value: {
        workerRequestId: request._id,
        missionId: request.missionId,
        runId: request.runId,
        generation: request.generation,
        workflowGeneration: request.workflowGeneration,
        outcome,
        detail,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes("Event already sent") &&
      !message.includes("Event already consumed")
    ) {
      throw error;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sweep — lease expiry, control expiry, challenge expiry                */
/* ------------------------------------------------------------------ */

/**
 * Periodic consistency sweep. Scheduled by the bridge on every lease
 * extension (and safe to run manually): expired leases make the request and
 * the slot `uncertain` — never silently freed; dead-mission pending rows are
 * cancelled; stale-generation rows are cancelled; expired control requests
 * and login challenges are retired; expired credentials are revoked.
 */
export const sweepExpiredLeases = internalMutation({
  args: {},
  returns: v.object({
    expiredRequests: v.number(),
    cancelledRequests: v.number(),
    expiredControl: v.number(),
    deletedChallenges: v.number(),
    revokedCredentials: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let expiredRequests = 0;
    let cancelledRequests = 0;
    let expiredControl = 0;
    let deletedChallenges = 0;
    let revokedCredentials = 0;

    // 1. Expired leases → uncertain (request + slot), signal the workflow,
    //    enqueue an interrupt_turn so termination gets confirmed.
    for (const state of ["leased", "running"] as const) {
      const rows = await ctx.db
        .query("workerRequests")
        .withIndex("by_state_and_leaseExpiresAt", (q) =>
          q.eq("state", state).lt("leaseExpiresAt", now),
        )
        .take(32);
      for (const request of rows) {
        await ctx.db.patch("workerRequests", request._id, {
          state: "uncertain",
          error: {
            code: "lease_expired",
            message: "worker lease expired without a terminal report",
            retrySafety: "unknown",
          },
          updatedAt: now,
        });
        expiredRequests += 1;
        // The turn may have run and may have been billed; we cannot tell.
        // `uncertain` keeps the capacity blocked until something can.
        await settleModelRun(ctx, request, "markUncertain");
        const slot = await ctx.db
          .query("workspaceExecutionSlots")
          .withIndex("by_workspaceId", (q) =>
            q.eq("workspaceId", request.workspaceId),
          )
          .unique();
        if (
          slot !== null &&
          slot.workerRequestId === request._id &&
          slot.state === "held"
        ) {
          await ctx.db.patch("workspaceExecutionSlots", slot._id, {
            state: "uncertain",
            updatedAt: now,
          });
        }
        const run = await ctx.db.get("runs", request.runId);
        if (run !== null) {
          await finishRun(ctx, run, "uncertain", {
            errorMessage: "worker lease expired",
          });
        }
        await deliverCompletionSafe(ctx, request, "uncertain", "lease expired");
        // Ask the runtime to confirm termination (§7.7: replacement only
        // after confirmed interruption). When the recorded turn ref is
        // missing — e.g. the worker stalled before its first heartbeat —
        // a bare interrupt_turn still asks the worker "interrupt whatever
        // turn is running, or confirm none is"; without it the uncertain
        // slot would wedge forever.
        const connection = await ctx.db.get(
          "runtimeConnections",
          request.runtimeConnectionId,
        );
        if (
          connection !== null &&
          connection.generation === request.runtimeGeneration
        ) {
          const [threadId, turnId] = (connection.currentCodexTurnRef ?? "").split(":");
          const alreadyQueued = await ctx.db
            .query("runtimeControlRequests")
            .withIndex("by_runtimeConnectionId_and_state", (q) =>
              q.eq("runtimeConnectionId", connection._id).eq("state", "pending"),
            )
            .collect();
          const hasInterrupt = alreadyQueued.some(
            (r) => r.command === "interrupt_turn",
          );
          if (!hasInterrupt) {
            await ctx.db.insert("runtimeControlRequests", {
              workspaceId: request.workspaceId,
              runtimeConnectionId: connection._id,
              runtimeGeneration: request.runtimeGeneration,
              requestId: `sys-interrupt:${request._id}:${turnId ?? "none"}`,
              command: "interrupt_turn",
              state: "pending",
              requestedBy: "system",
              expiresAt: now + CONTROL_REQUEST_TTL_MS,
              createdAt: now,
              ...(turnId !== undefined && turnId !== "" ? { turnId } : {}),
              ...(threadId !== undefined && threadId !== ""
                ? { threadId }
                : {}),
            });
          }
        }
      }
    }

    // 2. Pending requests on dead missions or retired generations → cancel.
    const pending = await ctx.db
      .query("workerRequests")
      .withIndex("by_state_and_leaseExpiresAt", (q) => q.eq("state", "pending"))
      .take(64);
    for (const request of pending) {
      const connection = await ctx.db.get(
        "runtimeConnections",
        request.runtimeConnectionId,
      );
      const staleGeneration =
        connection === null ||
        connection.generation !== request.runtimeGeneration;
      const mission = await ctx.db.get("missions", request.missionId);
      const deadMission =
        mission === null ||
        mission.state === "cancelled" ||
        mission.state === "completed" ||
        mission.state === "failed";
      if (staleGeneration || deadMission) {
        const detail = staleGeneration
          ? "request predates the current runtime generation"
          : "mission terminated before dispatch";
        await ctx.db.patch("workerRequests", request._id, {
          state: "cancelled",
          error: {
            code: staleGeneration ? "stale_generation" : "mission_terminal",
            message: detail,
          },
          updatedAt: now,
        });
        cancelledRequests += 1;
        // Never claimed, so never executed — release the debit.
        await settleModelRun(ctx, request, "release");
        // Finish the run receipt too — the event alone leaves the run
        // `running` forever (sweepRuns only fires at mission termination,
        // which may already have passed for a completed mission).
        const run = await ctx.db.get("runs", request.runId);
        if (run !== null) {
          await finishRun(ctx, run, "cancelled", { errorMessage: detail });
        }
        await deliverCompletionSafe(
          ctx,
          request,
          "cancelled",
          staleGeneration ? "stale generation" : "mission terminal",
        );
      }
    }

    // 3. Expired control requests (bounded scan — no cross-workspace index).
    const controlRows = await ctx.db
      .query("runtimeControlRequests")
      .take(256);
    for (const request of controlRows) {
      if (
        (request.state === "pending" || request.state === "claimed") &&
        request.expiresAt <= now
      ) {
        await ctx.db.patch("runtimeControlRequests", request._id, {
          state: "expired",
        });
        expiredControl += 1;
      }
    }

    // 4. Expired login challenges — deleted, never surfaced afterwards.
    const challenges = await ctx.db
      .query("runtimeLoginChallenges")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(64);
    for (const challenge of challenges) {
      await ctx.db.delete("runtimeLoginChallenges", challenge._id);
      deletedChallenges += 1;
    }

    // 5. Expired credentials → revoked (authenticateWorker also checks the
    //    timestamp; this keeps the row state truthful for diagnostics).
    const active = await ctx.db.query("workerCredentials").take(256);
    for (const credential of active) {
      if (credential.state === "active" && credential.expiresAt <= now) {
        await ctx.db.patch("workerCredentials", credential._id, {
          state: "revoked",
        });
        revokedCredentials += 1;
      }
    }

    return {
      expiredRequests,
      cancelledRequests,
      expiredControl,
      deletedChallenges,
      revokedCredentials,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Credential issuance + sealing — shared by connect/reconnect and dev   */
/* tooling. AES-256-GCM under `OPENSQUAD_WORKER_SEAL_KEY` lets a         */
/* reconciled create rebuild an identical Box env body without storing   */
/* plaintext; the sealed envelope never leaves backend internals.        */
/* ------------------------------------------------------------------ */

function sealKeyBytes(): Uint8Array<ArrayBuffer> {
  const secret = process.env.OPENSQUAD_WORKER_SEAL_KEY;
  if (secret === undefined || secret.length < 16) {
    throw new Error(
      "OPENSQUAD_WORKER_SEAL_KEY is not set on this deployment; cannot seal worker credentials",
    );
  }
  return new TextEncoder().encode(secret) as Uint8Array<ArrayBuffer>;
}

async function sealKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", sealKeyBytes());
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : alphabet[c & 63]!;
  }
  return out;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = text.replace(/=+$/, "");
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error("invalid base64 in sealed credential");
    acc = (acc << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** `v1:<iv-b64>:<ct-b64>` AES-256-GCM envelope for a worker token. */
export async function sealCredential(plaintext: string): Promise<string> {
  const key = await sealKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

/** Open a sealed credential — server internals only (provisioning action). */
export async function unsealCredential(sealed: string): Promise<string> {
  const [version, ivPart, ctPart] = sealed.split(":");
  if (version !== "v1" || ivPart === undefined || ctPart === undefined) {
    throw new Error("malformed sealed credential");
  }
  const key = await sealKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivPart) },
    key,
    fromBase64(ctPart),
  );
  return new TextDecoder().decode(plaintext);
}

export async function issueCredentialRow(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    runtimeConnectionId: Id<"runtimeConnections">;
    runtimeGeneration: number;
    scopes: Doc<"workerCredentials">["scopes"];
    /** Seal the plaintext for provider env injection / replay. */
    seal?: boolean;
    ttlMs?: number;
  },
): Promise<{ credentialId: Id<"workerCredentials">; token: string }> {
  const token = mintWorkerToken();
  const credentialHash = await sha256Hex(token);
  const existing = await ctx.db
    .query("workerCredentials")
    .withIndex("by_credentialHash", (q) => q.eq("credentialHash", credentialHash))
    .unique();
  if (existing !== null) {
    // Practically impossible — treat as a defect, not a retry.
    throw bridgeError("UNAVAILABLE", "credential collision; retry issuance");
  }
  const credentialId = await ctx.db.insert("workerCredentials", {
    workspaceId: args.workspaceId,
    runtimeConnectionId: args.runtimeConnectionId,
    runtimeGeneration: args.runtimeGeneration,
    credentialHash,
    scopes: args.scopes,
    expiresAt: Date.now() + (args.ttlMs ?? WORKER_CREDENTIAL_TTL_MS),
    state: "active",
    createdAt: Date.now(),
    ...(args.seal === true
      ? { sealedCredential: await sealCredential(token) }
      : {}),
  });
  return { credentialId, token };
}

/* ------------------------------------------------------------------ */
/* Staging/diagnostic helpers — developer-only internal functions.       */
/*                                                                     */
/* These exist so the bridge can be exercised on an isolated deployment  */
/* (`convex run`) and so the worker's V05/V06/V18 fault/replay scenarios  */
/* can be staged without a live Box. They are internal — unreachable     */
/* from client code and from every HTTP route — and they never mint      */
/* real provider state.                                                  */
/* ------------------------------------------------------------------ */

/**
 * The employee template that owns each bounded operation — the dev seeders'
 * copy, deliberately local to this developer-only section. The authority is
 * `HOST_CAPABILITY_POLICY` plus `OPERATION_CAPABILITY_REQUIREMENT`, which
 * `deriveRequestCapabilities` enforces at dispatch; this table only decides
 * which seeded employee the fixture acts as.
 */
const FIXTURE_TEMPLATE_FOR: Readonly<Record<WorkerOperation, EmployeeTemplate>> =
  {
    discover: "scout",
    contact: "scout",
    research: "researcher",
    draft: "outreach",
    classify_reply: "outreach",
  };

/**
 * Seed a complete bridge fixture on an isolated deployment: workspace +
 * owner membership + confirmed campaign + active mission + run receipt +
 * runtimeConnection (state `connecting`) + scoped credential + one pending
 * workerRequest bound to a real workflow event. Returns the plaintext token
 * ONCE (the row stores only the hash). NOT reachable from clients/HTTP.
 */
export const devSeedFixture = internalMutation({
  args: {
    operation: v.optional(vWorkerOperation),
    workspaceName: v.optional(v.string()),
    /** Narrow the acting employee's stored capabilities before dispatch, so
     *  the FORBIDDEN half of the capability gate can be driven directly:
     *  `[]` makes the dispatch refuse rather than issue a capability set. */
    narrowEmployeeCapabilities: v.optional(v.array(vCapabilityId)),
    /** Campaign lead ceiling, which is also the campaign's research-page
     *  allowance (`leadLimit * RESEARCH_PAGES_PER_PROSPECT`). Seed a small
     *  one to exhaust the allowance without a large paid run. */
    leadLimit: v.optional(v.number()),
    /** How many prospects to seed on the campaign (default 1, max 5). More
     *  than one is what lets the CAMPAIGN allowance bind before any single
     *  prospect's own page cap does. */
    prospectCount: v.optional(v.number()),
  },
  returns: v.object({
    workspaceId: v.id("workspaces"),
    missionId: v.id("missions"),
    runId: v.id("runs"),
    runtimeConnectionId: v.id("runtimeConnections"),
    runtimeGeneration: v.number(),
    workerRequestId: v.id("workerRequests"),
    continuationEventId: v.string(),
    workerToken: v.string(),
    missionWorkflowId: v.string(),
    employeeId: v.id("employees"),
    campaignId: v.id("campaigns"),
    prospectId: v.id("prospects"),
    prospectIds: v.array(v.id("prospects")),
    capabilities: v.array(vCapabilityId),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const identityKey = "dev-seed|owner";
    const name = boundedString(args.workspaceName ?? "P07 bridge fixture", "name", {
      min: 1,
      max: 100,
    });
    const sourcePlan = {
      instruction: "Fixture source plan (bridge exercise only)",
      sources: [
        {
          source: "apollo" as const,
          filters: { locations: ["US"], categories: ["software"] },
          maxResults: 5,
        },
      ],
      confirmedBy: identityKey,
      confirmedAt: now,
      confirmedBriefVersion: 1,
    };
    const workspaceId = await ctx.db.insert("workspaces", {
      name,
      ownerIdentityKey: identityKey,
      timezone: "UTC",
      automationState: "paused",
      pauseReason: "fixture",
      policyVersion: 1,
      dailySendLimit: 10,
      sendWindow: { weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 },
      demoMode: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("memberships", {
      workspaceId,
      identityKey,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    // One employee per template, each seeded at the exact host policy — the
    // fixture then dispatches as the employee that actually owns the
    // operation. Seeding a capability-less employee (as this fixture used
    // to) now makes every dispatch FORBIDDEN, which is the point: pass
    // `narrowEmployeeCapabilities` to ask for that refusal deliberately.
    const operation: WorkerOperation = args.operation ?? "research";
    const actingTemplate = FIXTURE_TEMPLATE_FOR[operation];
    const employeeIds: Record<EmployeeTemplate, Id<"employees">> = {
      scout: null as unknown as Id<"employees">,
      researcher: null as unknown as Id<"employees">,
      outreach: null as unknown as Id<"employees">,
    };
    for (const template of ["scout", "researcher", "outreach"] as const) {
      employeeIds[template] = await ctx.db.insert("employees", {
        workspaceId,
        template,
        name: `Fixture ${template}`,
        instructions: `Fixture ${template}`,
        instructionVersion: 1,
        enabled: true,
        allowedCapabilities:
          template === actingTemplate &&
          args.narrowEmployeeCapabilities !== undefined
            ? intersectCapabilities(template, args.narrowEmployeeCapabilities)
            : [...HOST_CAPABILITY_POLICY[template]],
        updatedAt: now,
      });
    }
    const actingEmployeeId = employeeIds[actingTemplate];
    const campaignId = await ctx.db.insert("campaigns", {
      workspaceId,
      title: "Bridge fixture campaign",
      brief: "Fixture brief",
      briefVersion: 1,
      sourcePlan,
      leadLimit:
        args.leadLimit === undefined
          ? 5
          : boundedInt(args.leadLimit, "leadLimit", {
              min: CAMPAIGN_LEAD_LIMIT_MIN,
              max: CAMPAIGN_LEAD_LIMIT_MAX,
            }),
      enrichmentLimit: 3,
      status: "active",
      createdBy: identityKey,
      createdAt: now,
      updatedAt: now,
    });
    const missionId = await ctx.db.insert("missions", {
      workspaceId,
      campaignId,
      kind: "sales_campaign",
      title: "Bridge fixture mission",
      state: "active",
      boardColumn: "in_flight",
      version: 1,
      inputSnapshot: {
        campaignTitle: "Bridge fixture campaign",
        campaignBrief: "Fixture brief",
        briefVersion: 1,
        sourcePlan,
        employeeInstructions: [
          {
            employeeId: actingEmployeeId,
            template: actingTemplate,
            name: `Fixture ${actingTemplate}`,
            instructionVersion: 1,
          },
        ],
        policyVersion: 1,
        requestedOutcome: "Fixture outcome",
      },
      inputVersion: 1,
      priority: "normal",
      assignedEmployeeId: actingEmployeeId,
      progressSummary: "Fixture",
      requiredDecisionCount: 0,
      visibility: "visible",
      createdBy: identityKey,
      createdAt: now,
      updatedAt: now,
      workflowGeneration: 1,
    });

    // A real durable workflow to bind the continuation event to. The dev
    // fixture parks at its decision wait; our completion event is a second,
    // independently-addressable event on the same workflow.
    const missionWorkflowId: WorkflowId = await start(
      ctx,
      internal.workflows.devFixture.devFixtureMissionWorkflow,
      { missionId },
      {
        startAsync: true,
        onComplete: internal.workflows.steps.onMissionWorkflowComplete,
        context: { missionId, workspaceId },
      },
    );
    await ctx.db.patch("missions", missionId, { workflowId: missionWorkflowId });

    // One persisted prospect on the fixture campaign. The research tool
    // route and the page allowance are both prospect-bound, so a fixture
    // with no prospect cannot exercise either.
    // IANA-reserved example domains only — a fixture must never name a real
    // company, and every one of these is safe to scrape.
    const FIXTURE_DOMAINS = [
      "example.com",
      "example.net",
      "example.org",
      "example.edu",
      "iana.org",
    ] as const;
    const prospectCount =
      args.prospectCount === undefined
        ? 1
        : boundedInt(args.prospectCount, "prospectCount", {
            min: 1,
            max: FIXTURE_DOMAINS.length,
          });
    const prospectIds: Id<"prospects">[] = [];
    for (const domain of FIXTURE_DOMAINS.slice(0, prospectCount)) {
      prospectIds.push(
        await ctx.db.insert("prospects", {
          workspaceId,
          campaignId,
          companyName: `Fixture Co (${domain})`,
          canonicalDomain: domain,
          sourceRefs: [
            {
              source: "apollo" as const,
              profileUrl: `https://${domain}/`,
              providerRecordId: `p21-bridge-fixture:${domain}`,
              retrievedAt: now,
            },
          ],
          qualification: "pending",
          fitReason: "Fixture prospect — developer bridge exercise only.",
          salesStage: "discovered",
          ownerIdentityKey: identityKey,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    const prospectId = prospectIds[0]!;

    const connectionId = await ctx.db.insert("runtimeConnections", {
      workspaceId,
      generation: 1,
      state: "connecting",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("providerConnections", {
      workspaceId,
      provider: "codex",
      state: "connecting",
      capabilities: [],
      updatedAt: now,
      runtimeConnectionId: connectionId,
    });
    const { token } = await issueCredentialRow(ctx, {
      workspaceId,
      runtimeConnectionId: connectionId,
      runtimeGeneration: 1,
      scopes: ["claim", "control", "heartbeat", "activity", "result", "artifact"],
    });

    const runId = await insertRun(ctx, {
      missionId,
      stage: "bridge_fixture",
      generation: 1,
      inputVersion: 1,
      inputSummary: "Bridge fixture request",
      employeeId: actingEmployeeId,
    });
    const dispatch = await dispatchWorkerRequestImpl(ctx, {
      missionId,
      runId,
      stepKey: "fixture-step",
      generation: 1,
      operation,
      input: fixtureInputFor(operation),
      outputSchemaVersion: 1,
      targetWorkflowId: missionWorkflowId,
      workflowGeneration: 1,
    });
    const seeded = await ctx.db.get(
      "workerRequests",
      dispatch.workerRequestId,
    );
    return {
      workspaceId,
      missionId,
      runId,
      runtimeConnectionId: connectionId,
      runtimeGeneration: 1,
      workerRequestId: dispatch.workerRequestId,
      continuationEventId: dispatch.continuationEventId,
      workerToken: token,
      missionWorkflowId,
      employeeId: actingEmployeeId,
      campaignId,
      prospectId,
      prospectIds,
      capabilities: seeded?.capabilities ?? [],
    };
  },
});

function fixtureInputFor(operation: WorkerOperation): Record<string, unknown> {
  return {
    schemaVersion: WORKER_INPUT_SCHEMA_VERSION,
    operation,
    prompt: `Fixture ${operation} prompt — developer bridge exercise only.`,
    constraints: { deadlineMs: 120_000, maxToolCalls: 4 },
    outputSchema: { type: "object" },
  };
}

/** Mint an additional credential (optionally scope-reduced) for scope-
 *  denial verification. Internal only; returns the plaintext once. */
export const devMintCredential = internalMutation({
  args: {
    runtimeConnectionId: v.id("runtimeConnections"),
    scopes: v.optional(v.array(v.string())),
  },
  returns: v.object({
    credentialId: v.id("workerCredentials"),
    workerToken: v.string(),
    runtimeGeneration: v.number(),
    workspaceId: v.id("workspaces"),
  }),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(
      "runtimeConnections",
      args.runtimeConnectionId,
    );
    if (connection === null) {
      throw domainError("NOT_FOUND", "runtime connection not found");
    }
    const scopes = (args.scopes ?? [
      "claim",
      "control",
      "heartbeat",
      "activity",
      "result",
      "artifact",
    ]) as Doc<"workerCredentials">["scopes"];
    for (const scope of scopes) {
      if (
        !["claim", "control", "heartbeat", "activity", "result", "artifact"].includes(
          scope,
        )
      ) {
        throw bridgeInvalid(`unknown scope ${scope}`);
      }
    }
    const { credentialId, token } = await issueCredentialRow(ctx, {
      workspaceId: connection.workspaceId,
      runtimeConnectionId: connection._id,
      runtimeGeneration: connection.generation,
      scopes,
    });
    return {
      credentialId,
      workerToken: token,
      runtimeGeneration: connection.generation,
      workspaceId: connection.workspaceId,
    };
  },
});

/** Force a request's lease into the past — stages the expired-lease path. */
export const devExpireLease = internalMutation({
  args: { workerRequestId: v.id("workerRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get("workerRequests", args.workerRequestId);
    if (request === null) {
      throw domainError("NOT_FOUND", "worker request not found");
    }
    await ctx.db.patch("workerRequests", request._id, {
      leaseExpiresAt: Date.now() - 1,
    });
    return null;
  },
});

/** Rotate a connection's generation — stages stale-generation rejection. */
export const devRotateGeneration = internalMutation({
  args: { runtimeConnectionId: v.id("runtimeConnections") },
  returns: v.object({ generation: v.number() }),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(
      "runtimeConnections",
      args.runtimeConnectionId,
    );
    if (connection === null) {
      throw domainError("NOT_FOUND", "runtime connection not found");
    }
    const generation = connection.generation + 1;
    await ctx.db.patch("runtimeConnections", connection._id, {
      generation,
      updatedAt: Date.now(),
    });
    return { generation };
  },
});

/** Enqueue a control request directly — stages the owner-control channel
 *  without requiring a Hexclave session on the local fixture. */
export const devEnqueueControl = internalMutation({
  args: {
    runtimeConnectionId: v.id("runtimeConnections"),
    command: v.string(),
    loginId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
  }),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(
      "runtimeConnections",
      args.runtimeConnectionId,
    );
    if (connection === null) {
      throw domainError("NOT_FOUND", "runtime connection not found");
    }
    if (
      ![
        "inspect_account",
        "start_login",
        "cancel_login",
        "logout",
        "interrupt_turn",
      ].includes(args.command)
    ) {
      throw bridgeInvalid(`unknown control command ${args.command}`);
    }
    const requestId =
      args.requestId !== undefined
        ? boundedString(args.requestId, "requestId", { min: 1, max: 100 })
        : mintBridgeRequestId();
    const existing = await ctx.db
      .query("runtimeControlRequests")
      .withIndex("by_workspaceId_and_requestId", (q) =>
        q
          .eq("workspaceId", connection.workspaceId)
          .eq("requestId", requestId),
      )
      .unique();
    if (existing !== null) {
      return { controlRequestId: existing._id, requestId };
    }
    const controlRequestId = await ctx.db.insert("runtimeControlRequests", {
      workspaceId: connection.workspaceId,
      runtimeConnectionId: connection._id,
      runtimeGeneration: connection.generation,
      requestId,
      command: args.command as Doc<"runtimeControlRequests">["command"],
      state: "pending",
      requestedBy: "dev-seed",
      expiresAt: Date.now() + (args.ttlMs ?? CONTROL_REQUEST_TTL_MS),
      createdAt: Date.now(),
      ...(args.loginId !== undefined ? { loginId: args.loginId } : {}),
      ...(args.turnId !== undefined ? { turnId: args.turnId } : {}),
      ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
    });
    return { controlRequestId, requestId };
  },
});

/** Seed a second workerRequest on the fixture mission (multi-claim tests). */
export const devSeedWorkerRequest = internalMutation({
  args: {
    missionId: v.id("missions"),
    operation: v.optional(vWorkerOperation),
    stepKey: v.optional(v.string()),
  },
  returns: v.object({
    workerRequestId: v.id("workerRequests"),
    runId: v.id("runs"),
    continuationEventId: v.string(),
  }),
  handler: async (ctx, args) => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
    }
    const operation: WorkerOperation = args.operation ?? "draft";
    // Attribute the run to the employee that owns the operation: the
    // dispatch derives its capability set from the run's employee, so a
    // `draft` request attributed to the scout would now be refused.
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_workspaceId_and_template", (q) =>
        q
          .eq("workspaceId", mission.workspaceId)
          .eq("template", FIXTURE_TEMPLATE_FOR[operation]),
      )
      .unique();
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "bridge_fixture",
      generation: 1,
      inputVersion: mission.inputVersion,
      inputSummary: "Bridge fixture request",
      employeeId: employee?._id ?? mission.assignedEmployeeId,
    });
    if (mission.workflowId === undefined) {
      throw domainError(
        "CONFLICT",
        "mission has no dispatched workflow — seed a workflow-bound mission first",
      );
    }
    const dispatch = await dispatchWorkerRequestImpl(ctx, {
      missionId: mission._id,
      runId,
      stepKey:
        args.stepKey !== undefined
          ? boundedString(args.stepKey, "stepKey", { min: 1, max: 200 })
          : `fixture-step-${Date.now()}`,
      generation: 1,
      operation,
      input: fixtureInputFor(operation),
      outputSchemaVersion: 1,
      targetWorkflowId: mission.workflowId,
      workflowGeneration: mission.workflowGeneration,
    });
    return {
      workerRequestId: dispatch.workerRequestId,
      runId,
      continuationEventId: dispatch.continuationEventId,
    };
  },
});

/** Sanitized bridge state dump for evidence — no tokens, no hashes. */
export const devDumpBridge = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    runtimeConnection: v.optional(v.any()),
    slot: v.optional(v.any()),
    workerRequests: v.array(v.any()),
    controlRequests: v.array(v.any()),
    loginChallenges: v.array(v.any()),
    credentials: v.array(v.any()),
    providerConnections: v.array(v.any()),
    agentSessions: v.array(v.any()),
    artifacts: v.array(v.any()),
  }),
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("runtimeConnections")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const slot = await ctx.db
      .query("workspaceExecutionSlots")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    const requests = await ctx.db
      .query("workerRequests")
      .withIndex("by_workspaceId_and_state_and_createdAt", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(32);
    const controls =
      connection === null
        ? []
        : await ctx.db
            .query("runtimeControlRequests")
            .withIndex("by_runtimeConnectionId_and_state", (q) =>
              q.eq("runtimeConnectionId", connection._id),
            )
            .take(32);
    const challenges =
      connection === null
        ? []
        : await ctx.db
            .query("runtimeLoginChallenges")
            .withIndex("by_runtimeConnectionId", (q) =>
              q.eq("runtimeConnectionId", connection._id),
            )
            .take(8);
    const credentials =
      connection === null
        ? []
        : await ctx.db
            .query("workerCredentials")
            .withIndex("by_runtimeConnectionId_and_state", (q) =>
              q.eq("runtimeConnectionId", connection._id),
            )
            .take(16);
    const providers = await ctx.db
      .query("providerConnections")
      .withIndex("by_workspaceId_and_provider", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(16);
    const sessions = await ctx.db
      .query("agentSessions")
      .withIndex("by_workspaceId_and_employeeId_and_scopeKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(16);
    const artifacts = await ctx.db
      .query("artifacts")
      .withIndex("by_workspaceId_and_operationKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .take(16);
    const redactConnection = (doc: Doc<"runtimeConnections"> | null) =>
      doc === null
        ? undefined
        : {
            _id: doc._id,
            state: doc.state,
            generation: doc.generation,
            boxRef: doc.boxRef,
            lastHeartbeatAt: doc.lastHeartbeatAt,
            workerPhase: doc.workerPhase,
            workerVersion: doc.workerVersion,
            protocolVersion: doc.protocolVersion,
            codexAccountSummary: doc.codexAccountSummary,
            error: doc.error,
          };
    return {
      ...(connection !== null
        ? { runtimeConnection: redactConnection(connection) }
        : {}),
      ...(slot !== null
        ? {
            slot: {
              state: slot.state,
              generation: slot.generation,
              workerRequestId: slot.workerRequestId,
              leaseExpiresAt: slot.leaseExpiresAt,
            },
          }
        : {}),
      workerRequests: requests.map((r) => ({
        _id: r._id,
        state: r.state,
        operation: r.operation,
        generation: r.generation,
        leaseExpiresAt: r.leaseExpiresAt,
        resultId: r.resultId,
        resultDigest: r.resultDigest,
        error: r.error,
      })),
      controlRequests: controls.map((r) => ({
        _id: r._id,
        command: r.command,
        state: r.state,
        requestId: r.requestId,
        expiresAt: r.expiresAt,
        safeResult: r.safeResult,
      })),
      // Device-code material is bearer credential data — never dump it;
      // presence + expiry is enough for evidence.
      loginChallenges: challenges.map((c) => ({
        _id: c._id,
        expiresAt: c.expiresAt,
      })),
      credentials: credentials.map((c) => ({
        _id: c._id,
        state: c.state,
        scopes: c.scopes,
        expiresAt: c.expiresAt,
        hasSealedCredential: c.sealedCredential !== undefined,
      })),
      providerConnections: providers.map((p) => ({
        _id: p._id,
        provider: p.provider,
        state: p.state,
        verifiedAt: p.verifiedAt,
      })),
      agentSessions: sessions.map((s) => ({
        _id: s._id,
        scopeKey: s.scopeKey,
        codexThreadRef: s.codexThreadRef,
        runtimeGeneration: s.runtimeGeneration,
      })),
      artifacts: artifacts.map((a) => ({
        _id: a._id,
        kind: a.kind,
        operationKey: a.operationKey,
        byteSize: a.byteSize,
        contentDigest: a.contentDigest,
        workerRequestId: a.workerRequestId,
      })),
    };
  },
});
