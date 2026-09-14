/**
 * Scoped worker bridge — transport internals (P07, architecture §4.4/§7.7).
 *
 * Every function here is INTERNAL: the only caller is the authenticated
 * `/worker/*` HTTP surface in `convex/http.ts`, which hashes the bearer
 * token and forwards `credentialHash` — plaintext worker tokens never cross
 * a function boundary and are never persisted.
 *
 * Invariants enforced transactionally:
 * - A credential is scoped to one (workspace, runtimeConnection, generation).
 *   Revoked, expired, retired-generation or wrong-scope credentials are
 *   rejected before any payload is trusted.
 * - `claimWork` atomically acquires the workspace's single execution slot;
 *   a held or `uncertain` slot yields "no work" (204 at the HTTP layer).
 * - Heartbeats/results/failures require the matching request generation, the
 *   stored lease-token hash and an unexpired lease. Lease expiry marks the
 *   request AND the slot `uncertain` (swept in workerOperations) — it never
 *   frees the slot implicitly; replacement needs confirmed interruption.
 * - A result is applied exactly once: repeated identical resultId + digest
 *   acknowledges as a no-op; a reused resultId with a different digest is a
 *   recorded conflict.
 * - Terminal transitions signal the dispatching workflow via the recorded
 *   `continuationEventId` — assigned at dispatch, never trusted from the
 *   callback payload.
 */
import { sendEvent } from "@convex-dev/workflow";
import type { EventId } from "@convex-dev/workflow";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { finishRun } from "./runs";
import { recordActivityEvent } from "./activity";
import {
  ARTIFACT_KINDS,
  ARTIFACT_MIME_TYPES,
  ARTIFACT_MAX_BYTES,
  BRIDGE_MIN_POLL_INTERVAL_MS,
  HEARTBEAT_MIN_INTERVAL_MS,
  LOGIN_CHALLENGE_TTL_MS,
  WORKER_ACTIVITY_KINDS,
  WORKER_ACTIVITY_MIN_INTERVAL_MS,
  WORKER_LEASE_TTL_MS,
  assertLoginUserCode,
  assertLoginVerificationUrl,
  asRecord,
  boundedString,
  bridgeError,
  bridgeInvalid,
  computeResultDigest,
  mintLeaseToken,
  parseWorkerResult,
  sha256Hex,
  vWorkerPhase,
  vWorkerRequestCompletion,
} from "./lib/validators";
import type { WorkerScope } from "./lib/validators";

/** What an authenticated call resolves to. */
type WorkerAuth = {
  credential: Doc<"workerCredentials">;
  connection: Doc<"runtimeConnections">;
};

/** States in which a runtime credential may still authenticate. A stopping
 *  runtime stays reachable so in-flight workers receive stop instructions. */
const BRIDGE_REACHABLE_STATES = new Set([
  "provisioning",
  "connecting",
  "ready",
  "stopping",
]);

/**
 * Resolve + validate a worker credential inside the calling transaction.
 * Revocation and generation rotation therefore take effect atomically —
 * there is no cache to go stale.
 */
async function authenticateWorker(
  ctx: MutationCtx,
  credentialHash: string,
  scope: WorkerScope,
): Promise<WorkerAuth> {
  const credential = await ctx.db
    .query("workerCredentials")
    .withIndex("by_credentialHash", (q) =>
      q.eq("credentialHash", credentialHash),
    )
    .unique();
  if (credential === null) {
    throw bridgeError("UNAUTHENTICATED", "invalid worker credential");
  }
  if (credential.state !== "active") {
    throw bridgeError("UNAUTHENTICATED", "worker credential is revoked");
  }
  if (credential.expiresAt <= Date.now()) {
    throw bridgeError("UNAUTHENTICATED", "worker credential is expired");
  }
  const connection = await ctx.db.get(
    "runtimeConnections",
    credential.runtimeConnectionId,
  );
  if (connection === null) {
    throw bridgeError("UNAUTHENTICATED", "runtime connection is gone");
  }
  if (connection.generation !== credential.runtimeGeneration) {
    // The runtime was replaced: every credential from an older generation
    // is dead even if the row still says active (revocation sweep racing).
    throw bridgeError(
      "UNAUTHENTICATED",
      "credential belongs to a retired runtime generation",
    );
  }
  if (!BRIDGE_REACHABLE_STATES.has(connection.state)) {
    throw bridgeError(
      "UNAUTHENTICATED",
      `runtime connection is ${connection.state}`,
    );
  }
  if (!credential.scopes.includes(scope)) {
    throw bridgeError("FORBIDDEN", `credential lacks the ${scope} scope`);
  }
  const now = Date.now();
  if (credential.lastUsedAt === undefined || now - credential.lastUsedAt > 30_000) {
    await ctx.db.patch("workerCredentials", credential._id, {
      lastUsedAt: now,
    });
  }
  return { credential, connection };
}

/** Payload-declared generation must match the credential's — a worker that
 *  reports another generation is stale (or confused); never apply. */
function assertGeneration(
  credential: Doc<"workerCredentials">,
  runtimeGeneration: number,
): void {
  if (runtimeGeneration !== credential.runtimeGeneration) {
    throw bridgeError(
      "CONFLICT",
      `stale runtimeGeneration ${runtimeGeneration}; current is ${credential.runtimeGeneration}`,
    );
  }
}

/** Minimum interval between claim-class polls on one credential. */
function throttlePoll(credential: Doc<"workerCredentials">): number | undefined {
  const now = Date.now();
  if (
    credential.lastPollAt !== undefined &&
    now - credential.lastPollAt < BRIDGE_MIN_POLL_INTERVAL_MS
  ) {
    return undefined;
  }
  return now;
}

/** Load a workerRequest scoped to the credential's workspace; unknown or
 *  foreign IDs are the same 400 — existence never leaks across scopes. */
async function loadScopedRequest(
  ctx: MutationCtx,
  credential: Doc<"workerCredentials">,
  workerRequestId: string,
): Promise<Doc<"workerRequests">> {
  const id = ctx.db.normalizeId("workerRequests", workerRequestId);
  const request = id === null ? null : await ctx.db.get("workerRequests", id);
  if (request === null || request.workspaceId !== credential.workspaceId) {
    throw bridgeInvalid("workerRequestId is not valid in this scope");
  }
  return request;
}

/** Slot row for a workspace — created lazily on first claim. */
async function loadSlot(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"workspaceExecutionSlots">> {
  const existing = await ctx.db
    .query("workspaceExecutionSlots")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  if (existing !== null) {
    return existing;
  }
  const id = await ctx.db.insert("workspaceExecutionSlots", {
    workspaceId,
    generation: 0,
    state: "idle",
    updatedAt: Date.now(),
  });
  const created = await ctx.db.get("workspaceExecutionSlots", id);
  if (created === null) {
    throw bridgeError("UNAVAILABLE", "failed to initialize execution slot");
  }
  return created;
}

/**
 * Verify the caller holds the request's live lease: matching request
 * generation, stored lease-token hash and unexpired lease, plus the slot
 * still held by this request. Throws 409 otherwise.
 */
function assertLiveLease(
  request: Doc<"workerRequests">,
  slot: Doc<"workspaceExecutionSlots"> | null,
  generation: number,
  leaseHash: string,
): void {
  if (generation !== request.generation) {
    throw bridgeError(
      "CONFLICT",
      `stale request generation ${generation}; current is ${request.generation}`,
    );
  }
  if (request.leaseHash === undefined || request.leaseHash !== leaseHash) {
    throw bridgeError("CONFLICT", "lease token does not match the holder");
  }
  if (request.leaseExpiresAt === undefined || request.leaseExpiresAt <= Date.now()) {
    throw bridgeError("CONFLICT", "lease has expired");
  }
  if (
    slot === null ||
    slot.state !== "held" ||
    slot.workerRequestId !== request._id
  ) {
    throw bridgeError(
      "CONFLICT",
      "execution slot is not held by this request",
    );
  }
}

/** Signal the awaiting workflow exactly-once-ish (component dedupes sends). */
async function deliverCompletion(
  ctx: MutationCtx,
  request: Doc<"workerRequests">,
  outcome: "succeeded" | "failed" | "cancelled" | "uncertain",
  detail?: string,
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
        ...(detail !== undefined ? { detail } : {}),
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

/** Release the workspace slot held by a request → idle. */
async function releaseSlot(
  ctx: MutationCtx,
  request: Doc<"workerRequests">,
): Promise<void> {
  const slot = await ctx.db
    .query("workspaceExecutionSlots")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", request.workspaceId))
    .unique();
  if (slot !== null && slot.workerRequestId === request._id) {
    await ctx.db.patch("workspaceExecutionSlots", slot._id, {
      state: "idle",
      generation: slot.generation + 1,
      workerRequestId: undefined,
      runId: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
  }
}

const vClaimArgs = {
  credentialHash: v.string(),
  requestId: v.string(),
  runtimeGeneration: v.number(),
  protocolVersion: v.string(),
};

/**
 * POST /worker/claim — atomically acquire the workspace slot and lease the
 * oldest eligible pending request. Returns `{claimed:false}` (→ HTTP 204)
 * when nothing is claimable: no pending work, a held/uncertain slot, or only
 * stale-generation requests.
 */
export const claimWork = internalMutation({
  args: vClaimArgs,
  returns: v.union(
    v.object({ claimed: v.literal(false) }),
    v.object({
      claimed: v.literal(true),
      workerRequestId: v.id("workerRequests"),
      runId: v.id("runs"),
      generation: v.number(),
      leaseToken: v.string(),
      leaseExpiresAt: v.number(),
      operation: v.string(),
      outputSchemaVersion: v.number(),
      input: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const { credential, connection } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "claim",
    );
    assertGeneration(credential, args.runtimeGeneration);
    boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    boundedString(args.protocolVersion, "protocolVersion", {
      min: 1,
      max: 40,
    });

    const now = Date.now();
    const pollAt = throttlePoll(credential);
    if (pollAt === undefined) {
      throw bridgeError("THROTTLED", "claim polled too frequently");
    }
    await ctx.db.patch("workerCredentials", credential._id, {
      lastPollAt: pollAt,
    });

    // Eligibility: pending request on THIS connection + generation whose
    // mission is still live. Stale-generation or dead-mission rows are
    // skipped (the sweeper cancels them).
    const pending = await ctx.db
      .query("workerRequests")
      .withIndex("by_workspaceId_and_state_and_createdAt", (q) =>
        q
          .eq("workspaceId", credential.workspaceId)
          .eq("state", "pending"),
      )
      .take(32);

    const eligible: Doc<"workerRequests">[] = [];
    for (const request of pending) {
      if (
        request.runtimeConnectionId !== connection._id ||
        request.runtimeGeneration !== credential.runtimeGeneration
      ) {
        continue;
      }
      const mission = await ctx.db.get("missions", request.missionId);
      if (mission === null) {
        continue;
      }
      if (
        mission.state === "cancelled" ||
        mission.state === "completed" ||
        mission.state === "failed"
      ) {
        // Dead mission — cancel the transport row so it never claims again.
        await ctx.db.patch("workerRequests", request._id, {
          state: "cancelled",
          error: {
            code: "mission_terminal",
            message: `mission is ${mission.state}`,
          },
          updatedAt: now,
        });
        await deliverCompletion(ctx, request, "cancelled", "mission terminal");
        continue;
      }
      if (mission.state === "paused") {
        continue; // parked — stays pending for a later claim
      }
      // queued / active / waiting_for_user / waiting_for_runtime stay
      // claimable: a request dispatched before a decision wait must not
      // strand, and dispatch gating itself lives in the workflow.
      eligible.push(request);
    }

    if (eligible.length === 0) {
      return { claimed: false as const };
    }

    const slot = await loadSlot(ctx, credential.workspaceId);
    if (slot.state !== "idle") {
      // One model run per workspace — a held or uncertain slot blocks claim.
      return { claimed: false as const };
    }

    const request = eligible[0]!;
    if (request.inputRef.kind !== "inline") {
      // Must run BEFORE any state mutation — throwing here must leave the
      // request pending and the slot idle, not a leased request holding a
      // slot the worker never received.
      throw bridgeError(
        "UNAVAILABLE",
        "storage-backed inputs are not servable by this build",
      );
    }
    const leaseToken = mintLeaseToken();
    const leaseExpiresAt = now + WORKER_LEASE_TTL_MS;
    const leaseHash = await sha256Hex(leaseToken);

    await ctx.db.patch("workerRequests", request._id, {
      state: "leased",
      leaseHash,
      leaseExpiresAt,
      lastHeartbeatAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("workspaceExecutionSlots", slot._id, {
      state: "held",
      generation: slot.generation + 1,
      workerRequestId: request._id,
      runId: request.runId,
      leaseExpiresAt,
      updatedAt: now,
    });
    // Self-healing sweep timer: expiry → uncertain without needing a cron.
    await ctx.scheduler.runAfter(
      WORKER_LEASE_TTL_MS + 5_000,
      internal.workerOperations.sweepExpiredLeases,
      {},
    );

    return {
      claimed: true as const,
      workerRequestId: request._id,
      runId: request.runId,
      generation: request.generation,
      leaseToken,
      leaseExpiresAt,
      operation: request.operation,
      outputSchemaVersion: request.outputSchemaVersion,
      input: request.inputRef.value,
    };
  },
});

const vHeartbeatArgs = {
  credentialHash: v.string(),
  workerRequestId: v.string(),
  generation: v.number(),
  leaseToken: v.string(),
  runtimeGeneration: v.number(),
  phase: vWorkerPhase,
};

/**
 * POST /worker/heartbeat — renew a held lease. Returns an authoritative
 * instruction: `continue` while the mission wants the run, `stop` when the
 * request/mission terminated. Expired leases, hash mismatches and stale
 * generations are 409 conflicts — never silent renewals.
 */
export const heartbeat = internalMutation({
  args: vHeartbeatArgs,
  returns: v.object({
    acknowledged: v.boolean(),
    instruction: v.union(v.literal("continue"), v.literal("stop")),
    leaseExpiresAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const { credential, connection } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "heartbeat",
    );
    assertGeneration(credential, args.runtimeGeneration);
    const request = await loadScopedRequest(
      ctx,
      credential,
      args.workerRequestId,
    );
    if (request.runtimeGeneration !== credential.runtimeGeneration) {
      throw bridgeError("CONFLICT", "request belongs to a retired generation");
    }

    const now = Date.now();
    if (
      request.state === "succeeded" ||
      request.state === "failed" ||
      request.state === "cancelled" ||
      request.state === "uncertain"
    ) {
      // Terminal/uncertain — authoritative stop, not a conflict.
      return { acknowledged: true, instruction: "stop" as const };
    }
    if (request.state === "pending") {
      throw bridgeError("CONFLICT", "request is not leased");
    }

    const leaseHash = await sha256Hex(
      boundedString(args.leaseToken, "leaseToken", { min: 8, max: 200 }),
    );
    const slot = await ctx.db
      .query("workspaceExecutionSlots")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", credential.workspaceId),
      )
      .unique();
    assertLiveLease(request, slot, args.generation, leaseHash);

    if (
      request.lastHeartbeatAt !== undefined &&
      now - request.lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS
    ) {
      throw bridgeError("THROTTLED", "heartbeat too frequent");
    }

    const leaseExpiresAt = now + WORKER_LEASE_TTL_MS;
    await ctx.db.patch("workerRequests", request._id, {
      state: "running",
      leaseExpiresAt,
      lastHeartbeatAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("workspaceExecutionSlots", slot!._id, {
      leaseExpiresAt,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      WORKER_LEASE_TTL_MS + 5_000,
      internal.workerOperations.sweepExpiredLeases,
      {},
    );

    const mission = await ctx.db.get("missions", request.missionId);
    // waiting_for_user does NOT stop an in-flight run — the human wait is
    // the workflow's business, not a transport cancellation.
    const stopping =
      connection.state === "stopping" ||
      mission === null ||
      mission.state === "paused" ||
      mission.state === "cancelled" ||
      mission.state === "completed" ||
      mission.state === "failed";
    return {
      acknowledged: true,
      instruction: stopping ? ("stop" as const) : ("continue" as const),
      leaseExpiresAt,
    };
  },
});

const vActivityArgs = {
  credentialHash: v.string(),
  workerRequestId: v.string(),
  generation: v.number(),
  leaseToken: v.string(),
  runtimeGeneration: v.number(),
  eventId: v.string(),
  kind: v.string(),
  summary: v.string(),
  phase: v.optional(vWorkerPhase),
};

/**
 * POST /worker/activity — deduped, allowlisted, rate-limited runtime-origin
 * activity. `eventId` is the worker's idempotency key: replays insert
 * nothing twice. One routine update per request per 5 s.
 */
export const recordWorkerActivity = internalMutation({
  args: vActivityArgs,
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, args) => {
    const { credential } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "activity",
    );
    assertGeneration(credential, args.runtimeGeneration);
    const request = await loadScopedRequest(
      ctx,
      credential,
      args.workerRequestId,
    );
    if (request.runtimeGeneration !== credential.runtimeGeneration) {
      throw bridgeError("CONFLICT", "request belongs to a retired generation");
    }
    if (request.state !== "leased" && request.state !== "running") {
      throw bridgeError(
        "CONFLICT",
        `request is ${request.state}; activity requires a live lease`,
      );
    }
    const leaseHash = await sha256Hex(
      boundedString(args.leaseToken, "leaseToken", { min: 8, max: 200 }),
    );
    const activitySlot = await ctx.db
      .query("workspaceExecutionSlots")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", credential.workspaceId),
      )
      .unique();
    assertLiveLease(request, activitySlot, args.generation, leaseHash);
    const kind = boundedString(args.kind, "kind", { min: 1, max: 64 });
    if (!(WORKER_ACTIVITY_KINDS as readonly string[]).includes(kind)) {
      throw bridgeInvalid(`activity kind ${kind} is not allowlisted`);
    }
    const eventId = boundedString(args.eventId, "eventId", {
      min: 1,
      max: 100,
    });
    const summary = boundedString(args.summary, "summary", {
      min: 1,
      max: 500,
    });

    const now = Date.now();
    if (
      request.lastActivityAt !== undefined &&
      now - request.lastActivityAt < WORKER_ACTIVITY_MIN_INTERVAL_MS
    ) {
      throw bridgeError("THROTTLED", "routine activity is limited to one update per 5s");
    }

    await recordActivityEvent(ctx, {
      workspaceId: request.workspaceId,
      missionId: request.missionId,
      kind,
      summary,
      actor: "worker",
      dedupeKey: `wact:${request._id}:${eventId}`,
      runId: request.runId,
    });
    await ctx.db.patch("workerRequests", request._id, {
      lastActivityAt: now,
    });
    return { accepted: true };
  },
});

async function conflictOnDigestMismatch(
  ctx: MutationCtx,
  request: Doc<"workerRequests">,
): Promise<never> {
  await ctx.db.patch("workerRequests", request._id, {
    error: {
      code: "result_digest_conflict",
      message: "a repeated resultId carried a different digest",
      retrySafety: "unsafe",
    },
    updatedAt: Date.now(),
  });
  await recordActivityEvent(ctx, {
    workspaceId: request.workspaceId,
    missionId: request.missionId,
    kind: "worker_result_conflict",
    summary: "Conflicting digest for a repeated worker resultId — recorded",
    actor: "system",
    dedupeKey: `wconflict:${request._id}:${request.resultId ?? "unknown"}`,
    runId: request.runId,
  });
  throw bridgeError(
    "CONFLICT",
    "resultId was already applied with a different digest",
  );
}

const vResultArgs = {
  credentialHash: v.string(),
  workerRequestId: v.string(),
  generation: v.number(),
  leaseToken: v.string(),
  runtimeGeneration: v.number(),
  resultId: v.string(),
  resultDigest: v.string(),
  result: v.any(),
};

/**
 * POST /worker/result — apply a schemaVersion-1 structured result exactly
 * once. Immutable afterwards: identical repeats acknowledge, a reused
 * resultId with a different digest is a recorded conflict, and stale
 * generations/leases/requests are 409s.
 */
export const applyResult = internalMutation({
  args: vResultArgs,
  returns: v.object({ acknowledged: v.boolean(), duplicate: v.boolean() }),
  handler: async (ctx, args): Promise<{ acknowledged: boolean; duplicate: boolean }> => {
    const { credential } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "result",
    );
    assertGeneration(credential, args.runtimeGeneration);
    const resultId = boundedString(args.resultId, "resultId", {
      min: 1,
      max: 100,
    });
    const resultDigest = boundedString(args.resultDigest, "resultDigest", {
      min: 1,
      max: 100,
    });
    const request = await loadScopedRequest(
      ctx,
      credential,
      args.workerRequestId,
    );
    if (request.runtimeGeneration !== credential.runtimeGeneration) {
      throw bridgeError("CONFLICT", "request belongs to a retired generation");
    }

    // Immutable terminal replay handling.
    if (request.state === "succeeded") {
      if (request.resultId === resultId) {
        if (request.resultDigest === resultDigest) {
          return { acknowledged: true, duplicate: true };
        }
        await conflictOnDigestMismatch(ctx, request);
      }
      throw bridgeError(
        "CONFLICT",
        "a result was already applied for this request",
      );
    }
    if (
      request.state === "failed" ||
      request.state === "cancelled" ||
      request.state === "uncertain"
    ) {
      throw bridgeError(
        "CONFLICT",
        `request is ${request.state}; results can no longer be applied`,
      );
    }
    if (request.state === "pending") {
      throw bridgeError("CONFLICT", "request is not leased");
    }

    const leaseHash = await sha256Hex(
      boundedString(args.leaseToken, "leaseToken", { min: 8, max: 200 }),
    );
    const slot = await ctx.db
      .query("workspaceExecutionSlots")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", credential.workspaceId),
      )
      .unique();
    assertLiveLease(request, slot, args.generation, leaseHash);

    // Validate the envelope against the request's contracted operation.
    const parsed = parseWorkerResult(args.result, request.operation);
    const serverDigest = await computeResultDigest(parsed);
    if (serverDigest !== resultDigest) {
      throw bridgeInvalid(
        "resultDigest does not match the canonical result body",
      );
    }

    const now = Date.now();
    await ctx.db.patch("workerRequests", request._id, {
      state: "succeeded",
      resultId,
      resultDigest: serverDigest,
      resultRef: { kind: "inline", value: parsed },
      ...(parsed.usage !== undefined ? { usage: parsed.usage } : {}),
      updatedAt: now,
    });
    await releaseSlot(ctx, request);
    const run = await ctx.db.get("runs", request.runId);
    if (run !== null) {
      await finishRun(ctx, run, "succeeded", {
        outputRefs: [`workerRequest:${request._id}`],
        ...(parsed.usage !== undefined ? { usage: parsed.usage } : {}),
      });
    }
    await deliverCompletion(ctx, request, "succeeded");
    return { acknowledged: true, duplicate: false };
  },
});

const vFailureArgs = {
  credentialHash: v.string(),
  workerRequestId: v.string(),
  generation: v.number(),
  leaseToken: v.string(),
  runtimeGeneration: v.number(),
  failureId: v.string(),
  code: v.string(),
  retrySafety: v.union(
    v.literal("safe"),
    v.literal("unsafe"),
    v.literal("unknown"),
  ),
  summary: v.string(),
};

/**
 * POST /worker/failure — record a bounded worker-side failure and release
 * the slot. Workflow owns the retry decision; `retrySafety` is advisory.
 */
export const applyFailure = internalMutation({
  args: vFailureArgs,
  returns: v.object({ acknowledged: v.boolean(), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const { credential } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "result",
    );
    assertGeneration(credential, args.runtimeGeneration);
    const failureId = boundedString(args.failureId, "failureId", {
      min: 1,
      max: 100,
    });
    const code = boundedString(args.code, "code", { min: 1, max: 100 });
    const summary = boundedString(args.summary, "summary", {
      min: 1,
      max: 500,
    });
    const request = await loadScopedRequest(
      ctx,
      credential,
      args.workerRequestId,
    );
    if (request.runtimeGeneration !== credential.runtimeGeneration) {
      throw bridgeError("CONFLICT", "request belongs to a retired generation");
    }

    if (request.state === "failed") {
      if (request.resultId === `failure:${failureId}`) {
        return { acknowledged: true, duplicate: true };
      }
      throw bridgeError(
        "CONFLICT",
        "a failure was already applied for this request",
      );
    }
    if (
      request.state === "succeeded" ||
      request.state === "cancelled" ||
      request.state === "uncertain"
    ) {
      throw bridgeError(
        "CONFLICT",
        `request is ${request.state}; failures can no longer be applied`,
      );
    }
    if (request.state === "pending") {
      throw bridgeError("CONFLICT", "request is not leased");
    }

    const leaseHash = await sha256Hex(
      boundedString(args.leaseToken, "leaseToken", { min: 8, max: 200 }),
    );
    const slot = await ctx.db
      .query("workspaceExecutionSlots")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", credential.workspaceId),
      )
      .unique();
    assertLiveLease(request, slot, args.generation, leaseHash);

    const now = Date.now();
    await ctx.db.patch("workerRequests", request._id, {
      state: "failed",
      resultId: `failure:${failureId}`,
      error: { code, message: summary, retrySafety: args.retrySafety },
      updatedAt: now,
    });
    await releaseSlot(ctx, request);
    const run = await ctx.db.get("runs", request.runId);
    if (run !== null) {
      await finishRun(ctx, run, "failed", {
        errorMessage: summary,
        retryable: args.retrySafety === "safe",
      });
    }
    await deliverCompletion(ctx, request, "failed", summary);
    return { acknowledged: true, duplicate: false };
  },
});

const vRuntimeHeartbeatArgs = {
  credentialHash: v.string(),
  runtimeGeneration: v.number(),
  workerVersion: v.string(),
  protocolVersion: v.string(),
  phase: vWorkerPhase,
  currentRunId: v.optional(v.id("runs")),
  currentCodexTurnRef: v.optional(v.string()),
};

/**
 * POST /worker/runtime-heartbeat — liveness + version reporting. Updates
 * only runtime transport state; it carries no lease or business effect.
 */
export const runtimeHeartbeat = internalMutation({
  args: vRuntimeHeartbeatArgs,
  returns: v.object({ acknowledged: v.boolean() }),
  handler: async (ctx, args) => {
    const { credential, connection } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "heartbeat",
    );
    assertGeneration(credential, args.runtimeGeneration);
    const workerVersion = boundedString(args.workerVersion, "workerVersion", {
      min: 1,
      max: 40,
    });
    const protocolVersion = boundedString(
      args.protocolVersion,
      "protocolVersion",
      { min: 1, max: 40 },
    );
    if (args.currentCodexTurnRef !== undefined) {
      boundedString(args.currentCodexTurnRef, "currentCodexTurnRef", {
        min: 1,
        max: 200,
      });
    }

    const now = Date.now();
    if (
      connection.lastHeartbeatAt !== undefined &&
      now - connection.lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS
    ) {
      throw bridgeError("THROTTLED", "runtime heartbeat too frequent");
    }
    // A reported run only counts when it belongs to this credential's
    // workspace — a worker must not pin a foreign run onto its connection.
    const reportedRun =
      args.currentRunId !== undefined
        ? await ctx.db.get("runs", args.currentRunId)
        : null;
    const scopedRun =
      reportedRun !== null && reportedRun.workspaceId === credential.workspaceId
        ? reportedRun
        : null;
    await ctx.db.patch("runtimeConnections", connection._id, {
      lastHeartbeatAt: now,
      workerPhase: args.phase,
      workerVersion,
      protocolVersion,
      // A live worker heartbeat is the first proof provisioning produced a
      // running service — promote provisioning → connecting.
      ...(connection.state === "provisioning"
        ? { state: "connecting" as const }
        : {}),
      ...(args.currentRunId !== undefined && scopedRun !== null
        ? { currentRunId: args.currentRunId }
        : {}),
      ...(args.currentCodexTurnRef !== undefined
        ? { currentCodexTurnRef: args.currentCodexTurnRef }
        : {}),
      updatedAt: now,
    });

    // Persist the thread/run reference so a replacement worker can
    // `thread/resume` the scoped session (§4.4 agentSessions). The turn ref
    // is `threadId:turnId`; the thread half is the resumable handle.
    if (
      scopedRun !== null &&
      args.currentCodexTurnRef !== undefined
    ) {
      const threadId = args.currentCodexTurnRef.split(":")[0];
      const run = scopedRun;
      if (
        threadId !== undefined &&
        threadId.length > 0
      ) {
        const scopeKey = `run:${args.currentRunId}`;
        const existing = await ctx.db
          .query("agentSessions")
          .withIndex("by_workspaceId_and_employeeId_and_scopeKey", (q) =>
            q
              .eq("workspaceId", run.workspaceId)
              .eq("employeeId", run.employeeId)
              .eq("scopeKey", scopeKey),
          )
          .unique();
        if (existing === null) {
          await ctx.db.insert("agentSessions", {
            workspaceId: run.workspaceId,
            employeeId: run.employeeId,
            scopeKey,
            runtimeConnectionId: connection._id,
            runtimeGeneration: credential.runtimeGeneration,
            codexThreadRef: threadId,
            createdAt: now,
            updatedAt: now,
          });
        } else if (existing.codexThreadRef !== threadId) {
          await ctx.db.patch("agentSessions", existing._id, {
            codexThreadRef: threadId,
            runtimeGeneration: credential.runtimeGeneration,
            updatedAt: now,
          });
        }
      }
    }
    return { acknowledged: true };
  },
});

/* ------------------------------------------------------------------ */
/* Artifact upload (two-phase: grant check → action-side store → link)  */
/* ------------------------------------------------------------------ */

const vArtifactGrantArgs = {
  credentialHash: v.string(),
  workerRequestId: v.string(),
  runtimeGeneration: v.number(),
  leaseToken: v.string(),
  operationKey: v.string(),
  mimeType: v.string(),
  byteSize: v.number(),
  digest: v.string(),
};

async function assertArtifactLease(
  ctx: MutationCtx,
  credential: Doc<"workerCredentials">,
  args: {
    workerRequestId: string;
    runtimeGeneration: number;
    leaseToken: string;
    operationKey: string;
    mimeType: string;
    byteSize: number;
    digest: string;
  },
): Promise<{ request: Doc<"workerRequests">; operationKey: string }> {
  assertGeneration(credential, args.runtimeGeneration);
  const request = await loadScopedRequest(
    ctx,
    credential,
    args.workerRequestId,
  );
  if (request.runtimeGeneration !== credential.runtimeGeneration) {
    throw bridgeError("CONFLICT", "request belongs to a retired generation");
  }
  if (request.state !== "leased" && request.state !== "running") {
    throw bridgeError(
      "CONFLICT",
      `request is ${request.state}; uploads require a live lease`,
    );
  }
  const leaseHash = await sha256Hex(
    boundedString(args.leaseToken, "leaseToken", { min: 8, max: 200 }),
  );
  const slot = await ctx.db
    .query("workspaceExecutionSlots")
    .withIndex("by_workspaceId", (q) =>
      q.eq("workspaceId", credential.workspaceId),
    )
    .unique();
  assertLiveLease(request, slot, request.generation, leaseHash);

  const operationKey = boundedString(args.operationKey, "operationKey", {
    min: 1,
    max: 200,
  });
  if (
    !(ARTIFACT_MIME_TYPES as readonly string[]).includes(args.mimeType)
  ) {
    throw bridgeInvalid(`mimeType ${args.mimeType} is not allowed`);
  }
  if (
    !Number.isSafeInteger(args.byteSize) ||
    args.byteSize < 1 ||
    args.byteSize > ARTIFACT_MAX_BYTES
  ) {
    throw bridgeInvalid(`byteSize must be 1..${ARTIFACT_MAX_BYTES}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(args.digest)) {
    throw bridgeInvalid("digest must be sha256:<64-hex>");
  }
  return { request, operationKey };
}

/** Phase 1 — validate scope/lease/metadata and dedupe on operationKey. */
export const checkArtifactGrant = internalMutation({
  args: vArtifactGrantArgs,
  returns: v.object({
    deduplicated: v.boolean(),
    artifactId: v.optional(v.id("artifacts")),
  }),
  handler: async (ctx, args) => {
    const { credential } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "artifact",
    );
    const { operationKey } = await assertArtifactLease(ctx, credential, args);
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_workspaceId_and_operationKey", (q) =>
        q
          .eq("workspaceId", credential.workspaceId)
          .eq("operationKey", operationKey),
      )
      .unique();
    if (existing !== null) {
      // Dedupe is content-addressed: a repeated key returns the prior
      // SAME-digest artifact. Different bytes under a reused key are a
      // conflict — silently returning the old artifact would drop the new
      // content while telling the worker the upload succeeded.
      if (existing.contentDigest !== args.digest) {
        throw bridgeError(
          "CONFLICT",
          "operationKey was already used with different content",
        );
      }
      return { deduplicated: true, artifactId: existing._id };
    }
    return { deduplicated: false };
  },
});

const vArtifactLinkArgs = {
  ...vArtifactGrantArgs,
  kind: v.string(),
  storageId: v.id("_storage"),
  prospectId: v.optional(v.string()),
};

/**
 * Phase 2 — re-validate inside a fresh transaction (the lease may have
 * expired mid-upload) and insert the artifact row. On rejection the HTTP
 * action deletes the just-stored blob; interrupted single-shot uploads never
 * reach storage, and `sweepOrphanArtifacts` reconciles row→blob drift.
 */
export const linkArtifact = internalMutation({
  args: vArtifactLinkArgs,
  returns: v.object({ artifactId: v.id("artifacts") }),
  handler: async (ctx, args) => {
    const { credential } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "artifact",
    );
    const { request, operationKey } = await assertArtifactLease(
      ctx,
      credential,
      args,
    );
    const kind = boundedString(args.kind, "kind", { min: 1, max: 40 });
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      throw bridgeInvalid(`artifact kind ${kind} is not recognized`);
    }
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_workspaceId_and_operationKey", (q) =>
        q
          .eq("workspaceId", credential.workspaceId)
          .eq("operationKey", operationKey),
      )
      .unique();
    if (existing !== null) {
      throw bridgeError(
        "CONFLICT",
        "operationKey already has an artifact — the upload was deduplicated",
      );
    }
    const artifactId = await ctx.db.insert("artifacts", {
      workspaceId: credential.workspaceId,
      missionId: request.missionId,
      kind: kind as Doc<"artifacts">["kind"],
      storageId: args.storageId,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      contentDigest: args.digest,
      operationKey,
      createdAt: Date.now(),
      runId: request.runId,
      workerRequestId: request._id,
      ...(args.prospectId !== undefined
        ? {
            prospectId: boundedString(args.prospectId, "prospectId", {
              min: 1,
              max: 100,
            }),
          }
        : {}),
    });
    return { artifactId };
  },
});

/**
 * Orphan reconciliation (§4.4): artifacts rows whose storage object is gone
 * are deleted; the reverse direction is prevented by construction (the blob
 * is deleted by the action when the link is rejected, and an interrupted
 * single-request upload never reaches storage). Schedulable or invoked via
 * `convex run` during reconciliation.
 */
export const sweepOrphanArtifacts = internalMutation({
  args: {},
  returns: v.object({ checked: v.number(), removed: v.number() }),
  handler: async (ctx) => {
    const recent = await ctx.db.query("artifacts").take(128);
    let removed = 0;
    for (const artifact of recent) {
      const metadata = await ctx.db.system.get("_storage", artifact.storageId);
      if (metadata === null) {
        await ctx.db.delete("artifacts", artifact._id);
        removed += 1;
      }
    }
    return { checked: recent.length, removed };
  },
});

/* ------------------------------------------------------------------ */
/* Owner control channel — claim + result (separate from model work)     */
/* ------------------------------------------------------------------ */

const vControlClaimArgs = {
  credentialHash: v.string(),
  requestId: v.string(),
  runtimeGeneration: v.number(),
  protocolVersion: v.string(),
};

/**
 * POST /worker/control/claim — fetch the next pending owner control command
 * for this runtime. Claims are idempotent: a re-claim of an already claimed,
 * unexpired request re-delivers the same command (crash recovery). Expired
 * requests are marked and never delivered.
 */
export const claimControl = internalMutation({
  args: vControlClaimArgs,
  returns: v.union(
    v.object({ claimed: v.literal(false) }),
    v.object({
      claimed: v.literal(true),
      controlRequestId: v.id("runtimeControlRequests"),
      command: v.string(),
      expiresAt: v.number(),
      loginId: v.optional(v.string()),
      turnId: v.optional(v.string()),
      threadId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const { credential, connection } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "control",
    );
    assertGeneration(credential, args.runtimeGeneration);
    boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    boundedString(args.protocolVersion, "protocolVersion", {
      min: 1,
      max: 40,
    });
    const pollAt = throttlePoll(credential);
    if (pollAt === undefined) {
      throw bridgeError("THROTTLED", "control claim polled too frequently");
    }
    await ctx.db.patch("workerCredentials", credential._id, {
      lastPollAt: pollAt,
    });

    const now = Date.now();
    const pending = await ctx.db
      .query("runtimeControlRequests")
      .withIndex("by_runtimeConnectionId_and_state", (q) =>
        q.eq("runtimeConnectionId", connection._id).eq("state", "pending"),
      )
      .take(16);
    const claimed = await ctx.db
      .query("runtimeControlRequests")
      .withIndex("by_runtimeConnectionId_and_state", (q) =>
        q.eq("runtimeConnectionId", connection._id).eq("state", "claimed"),
      )
      .take(16);

    // Opportunistic expiry — the dedicated sweep also runs on schedule.
    for (const request of [...pending, ...claimed]) {
      if (request.expiresAt <= now) {
        await ctx.db.patch("runtimeControlRequests", request._id, {
          state: "expired",
        });
      }
    }

    const live = [...claimed, ...pending].filter(
      (request) => request.expiresAt > now,
    );
    // Prefer re-delivering an in-flight claimed request (the worker may have
    // crashed after claiming); then the oldest pending command.
    const next = live.sort((a, b) => a.createdAt - b.createdAt)[0];
    if (next === undefined) {
      return { claimed: false as const };
    }
    if (next.state === "pending") {
      await ctx.db.patch("runtimeControlRequests", next._id, {
        state: "claimed",
        claimedAt: now,
      });
      // Claiming extends the window slightly so a just-claimed command does
      // not expire mid-execution — bounded by the original TTL either way.
      if (next.expiresAt - now < 30_000) {
        await ctx.db.patch("runtimeControlRequests", next._id, {
          expiresAt: now + 30_000,
        });
      }
    }
    return {
      claimed: true as const,
      controlRequestId: next._id,
      command: next.command,
      expiresAt: Math.max(next.expiresAt, now + 30_000),
      ...(next.loginId !== undefined ? { loginId: next.loginId } : {}),
      ...(next.turnId !== undefined ? { turnId: next.turnId } : {}),
      ...(next.threadId !== undefined ? { threadId: next.threadId } : {}),
    };
  },
});

const vControlResultArgs = {
  credentialHash: v.string(),
  controlRequestId: v.string(),
  runtimeGeneration: v.number(),
  resultId: v.string(),
  status: v.union(
    v.literal("challenge_issued"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  safeResult: v.any(),
};

/**
 * POST /worker/control/result — apply a control-command outcome. Accept-once
 * per resultId: an identical replay acknowledges; a reused resultId with a
 * different payload conflicts. `challenge_issued` is the single intermediate
 * status and is valid only for a claimed `start_login` — it stores the
 * provider-allowlisted login challenge, then the terminal `completed` /
 * `failed` lands later.
 */
export const applyControlResult = internalMutation({
  args: vControlResultArgs,
  returns: v.object({ acknowledged: v.boolean(), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const { credential, connection } = await authenticateWorker(
      ctx,
      args.credentialHash,
      "control",
    );
    assertGeneration(credential, args.runtimeGeneration);
    const resultId = boundedString(args.resultId, "resultId", {
      min: 1,
      max: 100,
    });
    const id = ctx.db.normalizeId(
      "runtimeControlRequests",
      args.controlRequestId,
    );
    const request =
      id === null ? null : await ctx.db.get("runtimeControlRequests", id);
    if (request === null || request.workspaceId !== credential.workspaceId) {
      throw bridgeInvalid("controlRequestId is not valid in this scope");
    }
    if (
      request.runtimeConnectionId !== connection._id ||
      request.runtimeGeneration !== credential.runtimeGeneration
    ) {
      throw bridgeError(
        "CONFLICT",
        "control request belongs to a retired generation",
      );
    }

    const digest = await computeResultDigest({
      status: args.status,
      safeResult: args.safeResult,
    });
    if (request.resultId === resultId) {
      if (request.resultDigest === digest) {
        return { acknowledged: true, duplicate: true };
      }
      throw bridgeError(
        "CONFLICT",
        "resultId was already applied with a different payload",
      );
    }

    const now = Date.now();
    if (
      request.state === "completed" ||
      request.state === "failed" ||
      request.state === "expired"
    ) {
      throw bridgeError(
        "CONFLICT",
        `control request is ${request.state}; results can no longer be applied`,
      );
    }
    if (request.expiresAt <= now) {
      await ctx.db.patch("runtimeControlRequests", request._id, {
        state: "expired",
      });
      throw bridgeError("CONFLICT", "control request has expired");
    }

    if (args.status === "challenge_issued") {
      if (request.command !== "start_login" || request.state !== "claimed") {
        throw bridgeInvalid(
          "challenge_issued is only valid for a claimed start_login",
        );
      }
      const challenge = asRecord(args.safeResult, "safeResult");
      const loginId = boundedString(
        challenge.loginId as string,
        "safeResult.loginId",
        { min: 1, max: 200 },
      );
      const verificationUrl = assertLoginVerificationUrl(
        challenge.verificationUrl as string,
      );
      const userCode = assertLoginUserCode(challenge.userCode as string);
      // One active challenge per connection — replace any older rows.
      const prior = await ctx.db
        .query("runtimeLoginChallenges")
        .withIndex("by_runtimeConnectionId", (q) =>
          q.eq("runtimeConnectionId", connection._id),
        )
        .collect();
      for (const row of prior) {
        await ctx.db.delete("runtimeLoginChallenges", row._id);
      }
      await ctx.db.insert("runtimeLoginChallenges", {
        workspaceId: request.workspaceId,
        runtimeConnectionId: connection._id,
        runtimeGeneration: request.runtimeGeneration,
        controlRequestId: request._id,
        verificationUrl,
        userCode,
        expiresAt: Math.min(now + LOGIN_CHALLENGE_TTL_MS, request.expiresAt),
        createdAt: now,
      });
      await ctx.db.patch("runtimeControlRequests", request._id, {
        loginId,
        resultId,
        resultDigest: digest,
      });
      return { acknowledged: true, duplicate: false };
    }

    // Terminal statuses: completed | failed.
    const safeResult = sanitizeSafeResult(args.safeResult);
    await ctx.db.patch("runtimeControlRequests", request._id, {
      state: args.status === "completed" ? "completed" : "failed",
      resultId,
      resultDigest: digest,
      safeResult,
      completedAt: now,
    });

    if (args.status === "completed") {
      await applyControlEffects(ctx, connection, request, args.safeResult);
    }
    // A login challenge never survives its command's terminal state.
    if (
      request.command === "start_login" ||
      request.command === "cancel_login"
    ) {
      const challenges = await ctx.db
        .query("runtimeLoginChallenges")
        .withIndex("by_runtimeConnectionId", (q) =>
          q.eq("runtimeConnectionId", connection._id),
        )
        .collect();
      for (const row of challenges) {
        if (row.controlRequestId === request._id) {
          await ctx.db.delete("runtimeLoginChallenges", row._id);
        }
      }
    }
    return { acknowledged: true, duplicate: false };
  },
});

/** Bound + sanitize a stored control result (no challenge material, ≤4KiB). */
function sanitizeSafeResult(value: unknown): Record<string, unknown> {
  const record = asRecord(value, "safeResult");
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "verificationUrl" || key === "userCode") {
      continue; // challenge material lives only in runtimeLoginChallenges
    }
    out[key] = entry;
  }
  const bytes = new TextEncoder().encode(JSON.stringify(out)).length;
  if (bytes > 4 * 1024) {
    throw bridgeInvalid("safeResult exceeds 4 KiB");
  }
  return out;
}

/** Apply the effects of a completed control command to runtime state. */
async function applyControlEffects(
  ctx: MutationCtx,
  connection: Doc<"runtimeConnections">,
  request: Doc<"runtimeControlRequests">,
  safeResult: unknown,
): Promise<void> {
  const now = Date.now();
  const result = asRecord(safeResult, "safeResult");
  switch (request.command) {
    case "inspect_account":
    case "start_login": {
      const account = asRecord(result.account, "safeResult.account");
      const state = account.state;
      if (
        state !== "none" &&
        state !== "chatgpt" &&
        state !== "apiKey" &&
        state !== "other"
      ) {
        throw bridgeInvalid("safeResult.account.state is not recognized");
      }
      const planType =
        typeof account.planType === "string"
          ? boundedString(account.planType, "safeResult.account.planType", {
              min: 1,
              max: 100,
            })
          : undefined;
      const summary = {
        state: state as "none" | "chatgpt" | "apiKey" | "other",
        ...(planType !== undefined ? { planType } : {}),
        verifiedAt: now,
      };
      // A managed (ChatGPT) login makes the runtime ready; API-key state is
      // recorded but is NOT a production login for OpenSquad workers.
      const nextState =
        request.command === "start_login" && state === "chatgpt"
          ? ("ready" as const)
          : connection.state === "provisioning"
            ? ("connecting" as const)
            : connection.state;
      await ctx.db.patch("runtimeConnections", connection._id, {
        codexAccountSummary: summary,
        state: nextState,
        updatedAt: now,
      });
      await upsertCodexProvider(ctx, connection, {
        state:
          state === "chatgpt"
            ? "ready"
            : state === "none"
              ? "connecting"
              : "expired",
        verifiedAt: now,
      });
      break;
    }
    case "cancel_login":
      // Challenge rows are deleted by the caller; nothing else to apply.
      break;
    case "logout": {
      await ctx.db.patch("runtimeConnections", connection._id, {
        codexAccountSummary: { state: "none", verifiedAt: now },
        updatedAt: now,
      });
      await upsertCodexProvider(ctx, connection, {
        state: "disconnected",
        verifiedAt: now,
      });
      break;
    }
    case "interrupt_turn": {
      const terminated = result.terminated === true;
      if (!terminated) {
        break;
      }
      // Confirmed termination releases the uncertain slot and fails the
      // interrupted request — replacement may now proceed (§7.7).
      const slot = await ctx.db
        .query("workspaceExecutionSlots")
        .withIndex("by_workspaceId", (q) =>
          q.eq("workspaceId", connection.workspaceId),
        )
        .unique();
      if (slot !== null && slot.state === "uncertain") {
        const interrupted =
          slot.workerRequestId !== undefined
            ? await ctx.db.get("workerRequests", slot.workerRequestId)
            : null;
        if (interrupted !== null && interrupted.state === "uncertain") {
          await ctx.db.patch("workerRequests", interrupted._id, {
            state: "failed",
            error: {
              code: "interrupted",
              message: "turn termination confirmed via interrupt_turn",
              retrySafety: "safe",
            },
            updatedAt: now,
          });
          const run = await ctx.db.get("runs", interrupted.runId);
          if (run !== null) {
            await finishRun(ctx, run, "failed", {
              errorMessage: "interrupted after lease expiry",
              retryable: true,
            });
          }
          await deliverCompletion(ctx, interrupted, "failed", "interrupted");
        }
        await ctx.db.patch("workspaceExecutionSlots", slot._id, {
          state: "idle",
          generation: slot.generation + 1,
          workerRequestId: undefined,
          runId: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
      }
      break;
    }
  }
}

async function upsertCodexProvider(
  ctx: MutationCtx,
  connection: Doc<"runtimeConnections">,
  update: { state: "disconnected" | "connecting" | "ready" | "expired" | "error"; verifiedAt: number },
): Promise<void> {
  const existing = await ctx.db
    .query("providerConnections")
    .withIndex("by_workspaceId_and_provider", (q) =>
      q.eq("workspaceId", connection.workspaceId).eq("provider", "codex"),
    )
    .unique();
  if (existing === null) {
    await ctx.db.insert("providerConnections", {
      workspaceId: connection.workspaceId,
      provider: "codex",
      state: update.state,
      capabilities: [],
      updatedAt: update.verifiedAt,
      runtimeConnectionId: connection._id,
      verifiedAt: update.verifiedAt,
    });
    return;
  }
  await ctx.db.patch("providerConnections", existing._id, {
    state: update.state,
    verifiedAt: update.verifiedAt,
    updatedAt: update.verifiedAt,
  });
}


