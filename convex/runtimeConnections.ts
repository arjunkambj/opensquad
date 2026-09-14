/**
 * Runtime connections — owner lifecycle + provisioning (P07).
 *
 * One ASCII Box + scoped worker per workspace. Owners connect / reconnect /
 * disconnect / read status; the actual provider calls run in the internal
 * `runLifecycleOperation` action against the ASCII Box REST API, driven by
 * the durable `runtimeLifecycleOperations` ledger:
 *
 *   mutation decides → ledger row (operationKey + requestFingerprint +
 *   neutral requestConfig) → action performs provider calls → recording
 *   mutation applies the outcome.
 *
 * Uncertain outcomes (timeout / transport error / 5xx / interrupted wait)
 * are recorded as `uncertain` — never retried blindly; `retryLifecycleOperation`
 * replays the SAME operationKey/fingerprint after reconciliation. Credentials
 * are sealed (AES-256-GCM under `OPENSQUAD_WORKER_SEAL_KEY`) so a reconciled
 * create can rebuild an identical injection body without storing plaintext.
 */
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  requireWorkspaceMember,
  requireWorkspaceOwner,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  assertLifecycleRequestConfig,
  boundedString,
  domainError,
  mintBridgeRequestId,
  sha256Hex,
  canonicalJson,
  RUNTIME_LIVE_WINDOW_MS,
} from "./lib/validators";
import type { LifecycleRequestConfig } from "./lib/validators";
import {
  cancelMissionWorkerRequests,
  issueCredentialRow,
  unsealCredential,
} from "./workerOperations";

/* ------------------------------------------------------------------ */
/* Status — the narrow DTO P08's IntegrationsSection / employee status   */
/* consume. Never carries tokens, sealed material, box internals or the  */
/* login challenge payload (that has its own owner-only query).          */
/* ------------------------------------------------------------------ */

export const vRuntimeStatus = v.object({
  exists: v.boolean(),
  state: v.optional(v.string()),
  generation: v.optional(v.number()),
  /** Fresh heartbeat within the liveness window AND state `ready`. */
  live: v.boolean(),
  lastHeartbeatAt: v.optional(v.number()),
  workerPhase: v.optional(v.string()),
  workerVersion: v.optional(v.string()),
  protocolVersion: v.optional(v.string()),
  codexAccountSummary: v.optional(
    v.object({
      state: v.string(),
      planType: v.optional(v.string()),
      verifiedAt: v.number(),
    }),
  ),
  /** A login challenge is pending (its material stays owner-only). */
  loginChallengePending: v.boolean(),
  hasBox: v.boolean(),
  error: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
});

export const getStatus = query({
  args: { workspaceId: v.id("workspaces") },
  returns: vRuntimeStatus,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const connection = await ctx.db
      .query("runtimeConnections")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (connection === null) {
      return { exists: false, live: false, loginChallengePending: false, hasBox: false };
    }
    const challenges = await ctx.db
      .query("runtimeLoginChallenges")
      .withIndex("by_runtimeConnectionId", (q) =>
        q.eq("runtimeConnectionId", connection._id),
      )
      .collect();
    const now = Date.now();
    const freshHeartbeat =
      connection.lastHeartbeatAt !== undefined &&
      now - connection.lastHeartbeatAt < RUNTIME_LIVE_WINDOW_MS;
    return {
      exists: true,
      state: connection.state,
      generation: connection.generation,
      live: connection.state === "ready" && freshHeartbeat,
      ...(connection.lastHeartbeatAt !== undefined
        ? { lastHeartbeatAt: connection.lastHeartbeatAt }
        : {}),
      ...(connection.workerPhase !== undefined
        ? { workerPhase: connection.workerPhase }
        : {}),
      ...(connection.workerVersion !== undefined
        ? { workerVersion: connection.workerVersion }
        : {}),
      ...(connection.protocolVersion !== undefined
        ? { protocolVersion: connection.protocolVersion }
        : {}),
      ...(connection.codexAccountSummary !== undefined
        ? { codexAccountSummary: connection.codexAccountSummary }
        : {}),
      loginChallengePending: challenges.some((row) => row.expiresAt > now),
      hasBox: connection.boxRef !== undefined,
      ...(connection.error !== undefined ? { error: connection.error } : {}),
      updatedAt: connection.updatedAt,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_BOX_TTL_SECONDS = 7 * 24 * 60 * 60;
const WORKER_ENV_NAMES = [
  "OPENSQUAD_BRIDGE_URL",
  "OPENSQUAD_RUNTIME_ID",
  "OPENSQUAD_RUNTIME_GENERATION",
  "OPENSQUAD_WORKER_TOKEN",
] as const;

async function getConnectionInWorkspace(
  ctx: AuthCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"runtimeConnections">> {
  const connection = await ctx.db
    .query("runtimeConnections")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .unique();
  if (connection === null) {
    throw domainError("NOT_FOUND", "runtime connection not found");
  }
  return connection;
}

/** Create a lifecycle ledger row (deduped on operationKey) and schedule its
 *  provider action. Returns the operation id + whether it already existed. */
async function openLifecycleOperation(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    connection: Doc<"runtimeConnections">;
    operation: "create" | "resume" | "extend_ttl" | "stop" | "delete";
    operationKey: string;
    requestConfig: LifecycleRequestConfig;
    /** For stop/delete: the box this teardown targets — pinned at open time
     *  so the op still finds its box after a generation bump clears
     *  connection.boxRef. */
    targetBoxRef?: string;
  },
): Promise<{ operationId: Id<"runtimeLifecycleOperations">; deduplicated: boolean }> {
  assertLifecycleRequestConfig(args.requestConfig);
  const existing = await ctx.db
    .query("runtimeLifecycleOperations")
    .withIndex("by_workspaceId_and_operationKey", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("operationKey", args.operationKey),
    )
    .unique();
  if (existing !== null) {
    return { operationId: existing._id, deduplicated: true };
  }
  const requestFingerprint = await sha256Hex(canonicalJson(args.requestConfig));
  const now = Date.now();
  const operationId = await ctx.db.insert("runtimeLifecycleOperations", {
    workspaceId: args.workspaceId,
    runtimeConnectionId: args.connection._id,
    runtimeGeneration: args.connection.generation,
    operation: args.operation,
    operationKey: args.operationKey,
    requestFingerprint,
    requestConfig: args.requestConfig,
    state: "pending",
    createdAt: now,
    updatedAt: now,
    // Teardown ops pin their target box at open time: a later generation
    // bump clears connection.boxRef, but the stop/delete must still find
    // the box it was issued for.
    ...(args.targetBoxRef !== undefined ? { boxRef: args.targetBoxRef } : {}),
  });
  await ctx.scheduler.runAfter(
    0,
    internal.runtimeConnections.runLifecycleOperation,
    { operationId },
  );
  return { operationId, deduplicated: false };
}

/** Revoke every active credential for a connection (generation rotation and
 *  disconnect share this) — plaintext seals are dropped too. */
async function revokeConnectionCredentials(
  ctx: MutationCtx,
  connectionId: Id<"runtimeConnections">,
): Promise<number> {
  const rows = await ctx.db
    .query("workerCredentials")
    .withIndex("by_runtimeConnectionId_and_state", (q) =>
      q.eq("runtimeConnectionId", connectionId).eq("state", "active"),
    )
    .collect();
  for (const row of rows) {
    await ctx.db.patch("workerCredentials", row._id, {
      state: "revoked",
      sealedCredential: undefined,
    });
  }
  return rows.length;
}

async function retireRuntimeInternals(
  ctx: MutationCtx,
  connection: Doc<"runtimeConnections">,
): Promise<void> {
  // Challenges: deleted immediately — they never outlive the session.
  const challenges = await ctx.db
    .query("runtimeLoginChallenges")
    .withIndex("by_runtimeConnectionId", (q) =>
      q.eq("runtimeConnectionId", connection._id),
    )
    .collect();
  for (const challenge of challenges) {
    await ctx.db.delete("runtimeLoginChallenges", challenge._id);
  }
  // Outstanding control requests: expired — a dead generation must not run.
  const controls = await ctx.db
    .query("runtimeControlRequests")
    .withIndex("by_runtimeConnectionId_and_state", (q) =>
      q.eq("runtimeConnectionId", connection._id),
    )
    .collect();
  for (const request of controls) {
    if (request.state === "pending" || request.state === "claimed") {
      await ctx.db.patch("runtimeControlRequests", request._id, {
        state: "expired",
      });
    }
  }
  // Non-terminal worker requests: cancelled — their callbacks stay invalid.
  // The cancellation must go through the mission-level canceller so each
  // run receipt is finished AND the awaiting workflow's continuation event
  // fires — patching the row alone would leave the workflow parked on an
  // awaitEvent that can never resolve.
  const requests = await ctx.db
    .query("workerRequests")
    .withIndex("by_workspaceId_and_state_and_createdAt", (q) =>
      q.eq("workspaceId", connection.workspaceId),
    )
    .take(64);
  const missionIds = new Set<Id<"missions">>();
  for (const request of requests) {
    if (
      request.runtimeConnectionId === connection._id &&
      (request.state === "pending" ||
        request.state === "leased" ||
        request.state === "running")
    ) {
      missionIds.add(request.missionId);
    }
  }
  for (const missionId of missionIds) {
    await cancelMissionWorkerRequests(ctx, missionId, {
      code: "runtime_retired",
      detail: "runtime was retired",
    });
  }
  // Slot: the runtime is gone — nothing is holding it.
  const slot = await ctx.db
    .query("workspaceExecutionSlots")
    .withIndex("by_workspaceId", (q) =>
      q.eq("workspaceId", connection.workspaceId),
    )
    .unique();
  if (slot !== null && slot.state !== "idle") {
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

/* ------------------------------------------------------------------ */
/* Owner mutations                                                       */
/* ------------------------------------------------------------------ */

const vStatusReturn = v.object({
  runtimeConnectionId: v.id("runtimeConnections"),
  state: v.string(),
  generation: v.number(),
  deduplicated: v.boolean(),
});

/**
 * Connect the workspace runtime (owner). First connect creates the
 * connection + a `create` lifecycle operation; a call while a connection is
 * already live is an idempotent no-op — replacement is `reconnect`'s job.
 */
export const connect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    requestId: v.optional(v.string()),
  },
  returns: vStatusReturn,
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const now = Date.now();
    let connection = await ctx.db
      .query("runtimeConnections")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();

    if (
      connection !== null &&
      (connection.state === "provisioning" ||
        connection.state === "connecting" ||
        connection.state === "ready")
    ) {
      // Already live/in-flight — connect is idempotent.
      return {
        runtimeConnectionId: connection._id,
        state: connection.state,
        generation: connection.generation,
        deduplicated: true,
      };
    }

    if (connection === null) {
      const id = await ctx.db.insert("runtimeConnections", {
        workspaceId: args.workspaceId,
        generation: 1,
        state: "provisioning",
        createdAt: now,
        updatedAt: now,
      });
      const created = await ctx.db.get("runtimeConnections", id);
      if (created === null) {
        throw new Error("runtime connection insert failed");
      }
      connection = created;
    } else {
      // Revive a terminal connection — same generation path as reconnect.
      const generation = connection.generation + 1;
      await ctx.db.patch("runtimeConnections", connection._id, {
        generation,
        state: "provisioning",
        boxRef: undefined,
        codexAccountSummary: undefined,
        currentCodexTurnRef: undefined,
        currentRunId: undefined,
        error: undefined,
        updatedAt: now,
      });
      await revokeConnectionCredentials(ctx, connection._id);
      await retireRuntimeInternals(ctx, connection);
      connection = { ...connection, generation, state: "provisioning" };
    }

    const requestId =
      args.requestId !== undefined
        ? boundedString(args.requestId, "requestId", { min: 1, max: 100 })
        : mintBridgeRequestId();
    const { deduplicated } = await openLifecycleOperation(ctx, {
      workspaceId: args.workspaceId,
      connection,
      operation: "create",
      operationKey: `create:${connection._id}:gen${connection.generation}:${requestId}`,
      requestConfig: {
        ttlSeconds: DEFAULT_BOX_TTL_SECONDS,
        envNames: [...WORKER_ENV_NAMES],
        ...(process.env.OPENSQUAD_WORKER_IMAGE !== undefined
          ? { image: process.env.OPENSQUAD_WORKER_IMAGE }
          : {}),
        ...(process.env.OPENSQUAD_WORKER_SETUP !== undefined
          ? { setup: process.env.OPENSQUAD_WORKER_SETUP }
          : {}),
      },
    });

    // Scoped credential minted up-front (sealed) — the provision action
    // injects it into the Box env. Replayed creates reuse the same seal so
    // the provider body stays identical.
    await issueCredentialRow(ctx, {
      workspaceId: args.workspaceId,
      runtimeConnectionId: connection._id,
      runtimeGeneration: connection.generation,
      scopes: ["claim", "control", "heartbeat", "activity", "result", "artifact"],
      seal: true,
    });

    return {
      runtimeConnectionId: connection._id,
      state: "provisioning",
      generation: connection.generation,
      deduplicated,
    };
  },
});

/**
 * Reconnect — replace the runtime with a NEW generation (owner). Old
 * credentials are revoked and old-generation claims/results/heartbeats stay
 * invalid forever; a fresh credential is minted and a `resume` (existing
 * Box) or `create` (no Box) operation is queued.
 */
export const reconnect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    requestId: v.optional(v.string()),
  },
  returns: vStatusReturn,
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    if (connection.state === "provisioning") {
      return {
        runtimeConnectionId: connection._id,
        state: connection.state,
        generation: connection.generation,
        deduplicated: true,
      };
    }
    const now = Date.now();
    const generation = connection.generation + 1;
    await ctx.db.patch("runtimeConnections", connection._id, {
      generation,
      state: "provisioning",
      codexAccountSummary: undefined,
      currentCodexTurnRef: undefined,
      currentRunId: undefined,
      error: undefined,
      updatedAt: now,
    });
    await revokeConnectionCredentials(ctx, connection._id);
    await retireRuntimeInternals(ctx, connection);

    const requestId =
      args.requestId !== undefined
        ? boundedString(args.requestId, "requestId", { min: 1, max: 100 })
        : mintBridgeRequestId();
    const operation = connection.boxRef !== undefined ? "resume" : "create";
    const { deduplicated } = await openLifecycleOperation(ctx, {
      workspaceId: args.workspaceId,
      connection: { ...connection, generation },
      operation,
      operationKey: `${operation}:${connection._id}:gen${generation}:${requestId}`,
      requestConfig: {
        ttlSeconds: DEFAULT_BOX_TTL_SECONDS,
        envNames: [...WORKER_ENV_NAMES],
        ...(process.env.OPENSQUAD_WORKER_IMAGE !== undefined
          ? { image: process.env.OPENSQUAD_WORKER_IMAGE }
          : {}),
        ...(process.env.OPENSQUAD_WORKER_SETUP !== undefined
          ? { setup: process.env.OPENSQUAD_WORKER_SETUP }
          : {}),
      },
    });
    await issueCredentialRow(ctx, {
      workspaceId: args.workspaceId,
      runtimeConnectionId: connection._id,
      runtimeGeneration: generation,
      scopes: ["claim", "control", "heartbeat", "activity", "result", "artifact"],
      seal: true,
    });
    return {
      runtimeConnectionId: connection._id,
      state: "provisioning",
      generation,
      deduplicated,
    };
  },
});

/**
 * Disconnect — revoke credentials, retire internals and stop (or delete)
 * the Box (owner). The effective boundary is credential revocation + Box
 * stop: the worker can no longer authenticate, and the provider call
 * archives the runtime. Idempotent on an already-terminal connection.
 */
export const disconnect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    requestId: v.optional(v.string()),
    deleteBox: v.optional(v.boolean()),
  },
  returns: vStatusReturn,
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    if (
      connection.state === "disconnected" ||
      connection.state === "stopped" ||
      connection.state === "stopping"
    ) {
      return {
        runtimeConnectionId: connection._id,
        state: connection.state,
        generation: connection.generation,
        deduplicated: true,
      };
    }
    const now = Date.now();
    await ctx.db.patch("runtimeConnections", connection._id, {
      state: "stopping",
      updatedAt: now,
    });
    await revokeConnectionCredentials(ctx, connection._id);
    await retireRuntimeInternals(ctx, connection);
    await upsertProviderState(ctx, connection, "disconnected");

    // A pending/accepted create, resume or extend_ttl still belongs to the
    // pre-stop intent — retire it so the action driver cannot race a fresh
    // box into a disconnecting runtime (the generation is unchanged, so the
    // ledger row alone is no protection).
    const lifecycleOps = await ctx.db
      .query("runtimeLifecycleOperations")
      .withIndex("by_runtimeConnectionId_and_createdAt", (q) =>
        q.eq("runtimeConnectionId", connection._id),
      )
      .collect();
    for (const op of lifecycleOps) {
      if (
        (op.state === "pending" || op.state === "accepted") &&
        (op.operation === "create" ||
          op.operation === "resume" ||
          op.operation === "extend_ttl")
      ) {
        await ctx.db.patch("runtimeLifecycleOperations", op._id, {
          state: "failed",
          error: "superseded by disconnect",
          updatedAt: now,
        });
      }
    }

    const requestId =
      args.requestId !== undefined
        ? boundedString(args.requestId, "requestId", { min: 1, max: 100 })
        : mintBridgeRequestId();
    const operation = args.deleteBox === true ? "delete" : "stop";
    const { deduplicated } = await openLifecycleOperation(ctx, {
      workspaceId: args.workspaceId,
      connection,
      operation,
      operationKey: `${operation}:${connection._id}:gen${connection.generation}:${requestId}`,
      requestConfig: { ttlSeconds: DEFAULT_BOX_TTL_SECONDS, envNames: [] },
      ...(connection.boxRef !== undefined
        ? { targetBoxRef: connection.boxRef }
        : {}),
    });
    return {
      runtimeConnectionId: connection._id,
      state: "stopping",
      generation: connection.generation,
      deduplicated,
    };
  },
});

async function upsertProviderState(
  ctx: MutationCtx,
  connection: Doc<"runtimeConnections">,
  state: "disconnected" | "connecting" | "ready" | "expired" | "error",
): Promise<void> {
  const existing = await ctx.db
    .query("providerConnections")
    .withIndex("by_workspaceId_and_provider", (q) =>
      q.eq("workspaceId", connection.workspaceId).eq("provider", "codex"),
    )
    .unique();
  const now = Date.now();
  if (existing === null) {
    await ctx.db.insert("providerConnections", {
      workspaceId: connection.workspaceId,
      provider: "codex",
      state,
      capabilities: [],
      updatedAt: now,
      runtimeConnectionId: connection._id,
    });
    return;
  }
  await ctx.db.patch("providerConnections", existing._id, {
    state,
    updatedAt: now,
  });
}

/* ------------------------------------------------------------------ */
/* ASCII Box REST adapter — narrow fetch client (the SDK lives in the    */
/* worker package; the backend needs only this subset).                  */
/* ------------------------------------------------------------------ */

const ASCII_BASE_URL = "https://ascii.dev/api/box/v1";
const ASCII_TIMEOUT_MS = 30_000;
const ASCII_READY_TIMEOUT_MS = 7 * 60_000;
const ASCII_POLL_INTERVAL_MS = 5_000;

type AsciiOutcome =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "uncertain"; detail: string; status?: number }
  | { kind: "failed"; detail: string; status?: number };

function asciiApiKey(): string {
  const key = process.env.ASCII_API_KEY;
  if (key === undefined || key === "") {
    throw new Error("ASCII_API_KEY is not set on this deployment");
  }
  return key;
}

/** One bounded ASCII request. Timeout/5xx/transport → uncertain, never
 *  "failed" — the provider may have applied the call. */
async function asciiRequest(
  method: string,
  path: string,
  options: {
    body?: unknown;
    idempotencyKey?: string;
    confirmDeleteId?: string;
    timeoutMs?: number;
  } = {},
): Promise<AsciiOutcome> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${asciiApiKey()}`,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  if (options.confirmDeleteId !== undefined) {
    headers["X-Ascii-Confirm-Delete"] = options.confirmDeleteId;
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("ascii_timeout")),
    options.timeoutMs ?? ASCII_TIMEOUT_MS,
  );
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${ASCII_BASE_URL}${path}`, {
      method,
      headers,
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    return {
      kind: "uncertain",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
  if (response.status >= 500) {
    return {
      kind: "uncertain",
      status: response.status,
      detail: text.slice(0, 300),
    };
  }
  if (!response.ok) {
    if (response.status === 404) {
      return { kind: "failed", status: 404, detail: "not found" };
    }
    return {
      kind: "failed",
      status: response.status,
      detail: text.slice(0, 300),
    };
  }
  try {
    return {
      kind: "ok",
      status: response.status,
      body: text.length > 0 ? (JSON.parse(text) as unknown) : null,
    };
  } catch {
    return {
      kind: "uncertain",
      status: response.status,
      detail: "success response was not valid JSON",
    };
  }
}

function boxStateOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const box = (body as Record<string, unknown>).box ?? body;
  const state = (box as Record<string, unknown>).state;
  return typeof state === "string" ? state : undefined;
}

function boxIdOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const box = (body as Record<string, unknown>).box ?? body;
  const id = (box as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

/* ------------------------------------------------------------------ */
/* Lifecycle action driver                                              */
/* ------------------------------------------------------------------ */

export const getLifecycleOperation = internalQuery({
  args: { operationId: v.id("runtimeLifecycleOperations") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("runtimeLifecycleOperations", args.operationId);
  },
});

/**
 * The provider-call driver. Reads the durable ledger row, performs the ASCII
 * calls with the persisted idempotency material, and records the outcome
 * through `recordLifecycleOutcome`. Never retries inside the action — an
 * `uncertain` outcome stays for explicit reconciliation.
 */
export const runLifecycleOperation = internalAction({
  args: { operationId: v.id("runtimeLifecycleOperations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = (await ctx.runQuery(
      internal.runtimeConnections.getLifecycleOperation,
      { operationId: args.operationId },
    )) as Doc<"runtimeLifecycleOperations"> | null;
    if (op === null) {
      return null;
    }
    if (
      op.state === "completed" ||
      op.state === "failed" ||
      op.state === "uncertain"
    ) {
      return null; // terminal or awaiting reconciliation
    }
    const connection = (await ctx.runQuery(
      internal.runtimeConnections.getRuntimeConnection,
      { runtimeConnectionId: op.runtimeConnectionId },
    )) as Doc<"runtimeConnections"> | null;
    // A teardown op with a pinned boxRef remains valid across a generation
    // bump — it must still reach the box it was issued for (reconnect/
    // revive clears connection.boxRef without stopping that box).
    const pinnedTeardown =
      (op.operation === "stop" || op.operation === "delete") &&
      op.boxRef !== undefined;
    if (
      connection === null ||
      (connection.generation !== op.runtimeGeneration && !pinnedTeardown)
    ) {
      await ctx.runMutation(
        internal.runtimeConnections.recordLifecycleOutcome,
        {
          operationId: op._id,
          outcome: "failed",
          error: "runtime generation moved on; operation is stale",
        },
      );
      return null;
    }
    // A create/resume/extend_ttl is meaningless once the connection is
    // tearing down: refuse to bring a box up under a dying runtime even if
    // its ledger row was still pending when read.
    if (
      (op.operation === "create" ||
        op.operation === "resume" ||
        op.operation === "extend_ttl") &&
      (connection.state === "stopping" ||
        connection.state === "stopped" ||
        connection.state === "disconnected")
    ) {
      await ctx.runMutation(
        internal.runtimeConnections.recordLifecycleOutcome,
        {
          operationId: op._id,
          outcome: "failed",
          error: `runtime connection is ${connection.state}; operation superseded`,
        },
      );
      return null;
    }

    await ctx.runMutation(internal.runtimeConnections.markLifecycleAccepted, {
      operationId: op._id,
    });

    if (process.env.ASCII_API_KEY === undefined) {
      await ctx.runMutation(
        internal.runtimeConnections.recordLifecycleOutcome,
        {
          operationId: op._id,
          outcome: "failed",
          error:
            "ASCII_API_KEY is not configured on this deployment; provisioning cannot proceed",
        },
      );
      return null;
    }

    const idempotencyKey = `osq-${(await sha256Hex(op.operationKey)).slice(0, 48)}`;
    try {
      switch (op.operation) {
        case "create":
          await runCreate(ctx, op, connection, idempotencyKey);
          break;
        case "resume":
          await runResume(ctx, op, connection);
          break;
        case "extend_ttl":
          await runExtendTtl(ctx, op, connection);
          break;
        case "stop":
          await runStop(ctx, op, connection);
          break;
        case "delete":
          await runDelete(ctx, op, connection);
          break;
      }
    } catch (error) {
      await ctx.runMutation(
        internal.runtimeConnections.recordLifecycleOutcome,
        {
          operationId: op._id,
          outcome: "uncertain",
          error:
            error instanceof Error
              ? error.message.slice(0, 300)
              : String(error).slice(0, 300),
        },
      );
    }
    return null;
  },
});

export const getRuntimeConnection = internalQuery({
  args: { runtimeConnectionId: v.id("runtimeConnections") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("runtimeConnections", args.runtimeConnectionId);
  },
});

export const markLifecycleAccepted = internalMutation({
  args: { operationId: v.id("runtimeLifecycleOperations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = await ctx.db.get("runtimeLifecycleOperations", args.operationId);
    if (op !== null && op.state === "pending") {
      await ctx.db.patch("runtimeLifecycleOperations", op._id, {
        state: "accepted",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Apply the recorded outcome to the ledger row + the connection. */
export const recordLifecycleOutcome = internalMutation({
  args: {
    operationId: v.id("runtimeLifecycleOperations"),
    outcome: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("uncertain"),
    ),
    boxRef: v.optional(v.string()),
    providerOperationRef: v.optional(v.string()),
    error: v.optional(v.string()),
    /** Connection state to apply on success (operation-specific). */
    connectionState: v.optional(v.string()),
    clearBoxRef: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = await ctx.db.get("runtimeLifecycleOperations", args.operationId);
    if (op === null) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("runtimeLifecycleOperations", op._id, {
      state: args.outcome,
      updatedAt: now,
      ...(args.boxRef !== undefined ? { boxRef: args.boxRef } : {}),
      ...(args.providerOperationRef !== undefined
        ? { providerOperationRef: args.providerOperationRef }
        : {}),
      ...(args.error !== undefined
        ? { error: boundedString(args.error, "error", { min: 0, max: 500 }) }
        : {}),
    });
    const connection = await ctx.db.get(
      "runtimeConnections",
      op.runtimeConnectionId,
    );
    if (connection === null) {
      return null;
    }
    // A stale-generation outcome must never rewrite the new generation's
    // connection row — the ledger entry above already records what the
    // provider did.
    if (connection.generation !== op.runtimeGeneration) {
      return null;
    }
    if (args.outcome === "completed") {
      // A create/resume/extend_ttl completing under a disconnect must not
      // flip the connection back to a live-looking state — the provider
      // effect is on the ledger; the connection stays stopping/stopped.
      const dyingConnection =
        connection.state === "stopping" ||
        connection.state === "stopped" ||
        connection.state === "disconnected";
      const provisioningOp =
        op.operation === "create" ||
        op.operation === "resume" ||
        op.operation === "extend_ttl";
      if (dyingConnection && provisioningOp) {
        return null;
      }
      const patch: Record<string, unknown> = {
        updatedAt: now,
        error: undefined,
      };
      if (args.boxRef !== undefined) {
        patch.boxRef = args.boxRef;
      }
      if (args.clearBoxRef === true) {
        patch.boxRef = undefined;
      }
      if (args.connectionState !== undefined) {
        patch.state = args.connectionState;
      }
      await ctx.db.patch("runtimeConnections", connection._id, patch);
      return null;
    }
    // failed | uncertain — surface the error on the connection; state moves
    // to `error` for failed ops and stays for uncertain (a reconcile may
    // still land it).
    await ctx.db.patch("runtimeConnections", connection._id, {
      ...(args.outcome === "failed"
        ? {
            state:
              connection.state === "provisioning"
                ? ("error" as const)
                : connection.state,
          }
        : {}),
      error: boundedString(
        args.error ?? `${op.operation} ${args.outcome}`,
        "error",
        { min: 0, max: 500 },
      ),
      updatedAt: now,
    });
    return null;
  },
});

/**
 * Explicit reconciliation entry point — replays a non-terminal lifecycle
 * operation with its persisted operationKey/fingerprint. The create path
 * re-derives an identical request body (sealed credential, neutral config)
 * so the provider's idempotency layer returns the original result.
 */
export const retryLifecycleOperation = internalMutation({
  args: { operationId: v.id("runtimeLifecycleOperations") },
  returns: v.object({ rescheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const op = await ctx.db.get("runtimeLifecycleOperations", args.operationId);
    if (op === null) {
      throw domainError("NOT_FOUND", "lifecycle operation not found");
    }
    if (op.state !== "uncertain" && op.state !== "accepted") {
      return { rescheduled: false };
    }
    await ctx.db.patch("runtimeLifecycleOperations", op._id, {
      state: "pending",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.runtimeConnections.runLifecycleOperation,
      { operationId: op._id },
    );
    return { rescheduled: true };
  },
});

/* ---- per-operation drivers ------------------------------------------- */

async function runCreate(
  ctx: ActionCtx,
  op: Doc<"runtimeLifecycleOperations">,
  connection: Doc<"runtimeConnections">,
  idempotencyKey: string,
): Promise<void> {
  const config = op.requestConfig as LifecycleRequestConfig;
  const bridgeUrl =
    process.env.OPENSQUAD_BRIDGE_URL ?? process.env.CONVEX_SITE_URL;
  if (bridgeUrl === undefined) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: "OPENSQUAD_BRIDGE_URL/CONVEX_SITE_URL is not configured",
    });
    return;
  }
  // Rebuild the env injection from the sealed credential — identical every
  // replay (the provider's idempotency key requires a byte-identical body).
  const sealed = (await ctx.runQuery(
    internal.runtimeConnections.readSealedCredential,
    { runtimeConnectionId: connection._id },
  )) as string | null;
  if (sealed === null) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: "no sealed worker credential for this generation",
    });
    return;
  }
  const env: Record<string, string> = {
    OPENSQUAD_BRIDGE_URL: bridgeUrl,
    OPENSQUAD_RUNTIME_ID: connection._id,
    OPENSQUAD_RUNTIME_GENERATION: String(connection.generation),
    OPENSQUAD_WORKER_TOKEN: await unsealCredential(sealed),
  };
  const create = await asciiRequest("POST", "/boxes", {
    idempotencyKey,
    body: {
      noEnv: true,
      ttlSeconds: config.ttlSeconds,
      env,
      ...(config.image !== undefined ? { from: config.image } : {}),
      ...(config.setup !== undefined ? { setupScript: config.setup } : {}),
    },
    timeoutMs: 60_000,
  });
  if (create.kind !== "ok") {
    await record(ctx, op._id, {
      outcome: create.kind === "failed" ? "failed" : "uncertain",
      error: `create ${create.kind}: ${create.detail}`,
    });
    return;
  }
  const boxId = boxIdOf(create.body);
  if (boxId === undefined) {
    await record(ctx, op._id, {
      outcome: "uncertain",
      error: "create returned no box id",
    });
    return;
  }
  const ready = await waitForBoxReady(boxId);
  if (ready.kind !== "ok") {
    await record(ctx, op._id, {
      outcome: "uncertain",
      boxRef: boxId,
      error: `readiness: ${ready.detail}`,
    });
    return;
  }
  // A disconnect committed while this create was in flight must not inherit
  // a live box — re-read the connection and tear the fresh box down instead
  // of claiming it (the ledger still records where the box went).
  const latest = (await ctx.runQuery(
    internal.runtimeConnections.getRuntimeConnection,
    { runtimeConnectionId: op.runtimeConnectionId },
  )) as Doc<"runtimeConnections"> | null;
  if (
    latest === null ||
    latest.generation !== op.runtimeGeneration ||
    latest.state === "stopping" ||
    latest.state === "stopped" ||
    latest.state === "disconnected"
  ) {
    await asciiRequest("POST", `/boxes/${encodeURIComponent(boxId)}/stop`, {
      body: {},
      timeoutMs: 60_000,
    });
    await record(ctx, op._id, {
      outcome: "completed",
      boxRef: boxId,
      error:
        "connection moved on during provisioning; fresh box stopped immediately",
    });
    return;
  }
  const bootstrap = await bootstrapBox(boxId, env, config);
  await record(ctx, op._id, {
    outcome: bootstrap.ok ? "completed" : "uncertain",
    boxRef: boxId,
    connectionState: "connecting",
    ...(bootstrap.ok ? {} : { error: bootstrap.error ?? "bootstrap failed" }),
  });
}

export const readSealedCredential = internalQuery({
  args: { runtimeConnectionId: v.id("runtimeConnections") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("workerCredentials")
      .withIndex("by_runtimeConnectionId_and_state", (q) =>
        q.eq("runtimeConnectionId", args.runtimeConnectionId).eq("state", "active"),
      )
      .collect();
    const sealed = rows.find((row) => row.sealedCredential !== undefined);
    return sealed?.sealedCredential ?? null;
  },
});

async function waitForBoxReady(
  boxId: string,
): Promise<
  | { kind: "ok" }
  | { kind: "uncertain"; detail: string }
  | { kind: "failed"; detail: string }
> {
  const deadline = Date.now() + ASCII_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const inspected = await asciiRequest(
      "GET",
      `/boxes/${encodeURIComponent(boxId)}`,
    );
    if (inspected.kind === "ok") {
      const state = boxStateOf(inspected.body);
      if (state === "ready" || state === "idle" || state === "running") {
        return { kind: "ok" };
      }
      if (state === "error" || state === "archived" || state === "archiving") {
        return { kind: "failed", detail: `box entered ${state}` };
      }
    } else if (inspected.kind === "failed" && inspected.status === 404) {
      return { kind: "failed", detail: "box vanished during provisioning" };
    }
    await sleep(ASCII_POLL_INTERVAL_MS);
  }
  return { kind: "uncertain", detail: "readiness poll timed out" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bootstrap the worker inside a ready Box: persist the worker env file
 * (same values the create body injected — a stop/resume cycle keeps them)
 * and run the documented image start command when `config.setup` names one.
 * With no setup configured the step is recorded as a no-op — the bounded
 * create→ready→stop→delete check does not need a worker service.
 */
async function bootstrapBox(
  boxId: string,
  env: Record<string, string>,
  config: LifecycleRequestConfig,
): Promise<{ ok: boolean; error?: string }> {
  const envContent =
    config.envNames
      .filter((name) => env[name] !== undefined)
      .map((name) => `${name}=${env[name]}`)
      .join("\n") + "\n";
  const written = await asciiRequest(
    "PUT",
    `/boxes/${encodeURIComponent(boxId)}/files`,
    { body: { path: "/etc/opensquad/worker.env", content: envContent } },
  );
  if (written.kind !== "ok") {
    return { ok: false, error: `env file write: ${written.detail}` };
  }
  if (config.setup === undefined) {
    return { ok: true }; // no image bootstrap configured — recorded, honest
  }
  const command = await asciiRequest(
    "POST",
    `/boxes/${encodeURIComponent(boxId)}/commands`,
    { body: { command: config.setup, detached: true } },
  );
  if (command.kind !== "ok") {
    return { ok: false, error: `bootstrap command: ${command.detail}` };
  }
  const processId =
    typeof command.body === "object" && command.body !== null
      ? ((command.body as Record<string, unknown>).processId as
          | string
          | undefined)
      : undefined;
  if (processId === undefined) {
    return { ok: false, error: "bootstrap command returned no processId" };
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const status = await asciiRequest(
      "GET",
      `/boxes/${encodeURIComponent(boxId)}/commands/${encodeURIComponent(processId)}?tailBytes=2048`,
    );
    if (status.kind === "ok") {
      const body = status.body as Record<string, unknown> | null;
      const type = body?.type as string | undefined;
      if (type === "command.done" || type === "command.exited") {
        const exitCode = body?.exitCode as number | undefined;
        if (exitCode === 0) {
          return { ok: true };
        }
        return { ok: false, error: `bootstrap exited ${exitCode}` };
      }
    } else if (status.kind === "uncertain") {
      return {
        ok: false,
        error: `bootstrap status uncertain: ${status.detail}`,
      };
    }
    await sleep(ASCII_POLL_INTERVAL_MS);
  }
  return { ok: false, error: "bootstrap command timed out" };
}

async function runResume(
  ctx: ActionCtx,
  op: Doc<"runtimeLifecycleOperations">,
  connection: Doc<"runtimeConnections">,
): Promise<void> {
  if (connection.boxRef === undefined) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: "resume requested without a box reference",
    });
    return;
  }
  const config = op.requestConfig as LifecycleRequestConfig;
  const bridgeUrl =
    process.env.OPENSQUAD_BRIDGE_URL ?? process.env.CONVEX_SITE_URL;
  if (bridgeUrl === undefined) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: "OPENSQUAD_BRIDGE_URL/CONVEX_SITE_URL is not configured",
    });
    return;
  }
  // The resumed box still carries the PREVIOUS generation's worker env —
  // its token was revoked and its runtimeGeneration is stale, so without
  // re-injection the service inside exits 78 and the reconnect can never
  // come up. Rebuild the same env create would have injected.
  const sealed = (await ctx.runQuery(
    internal.runtimeConnections.readSealedCredential,
    { runtimeConnectionId: connection._id },
  )) as string | null;
  if (sealed === null) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: "no sealed worker credential for this generation",
    });
    return;
  }
  const env: Record<string, string> = {
    OPENSQUAD_BRIDGE_URL: bridgeUrl,
    OPENSQUAD_RUNTIME_ID: connection._id,
    OPENSQUAD_RUNTIME_GENERATION: String(connection.generation),
    OPENSQUAD_WORKER_TOKEN: await unsealCredential(sealed),
  };
  const resumed = await asciiRequest(
    "POST",
    `/boxes/${encodeURIComponent(connection.boxRef)}/resume`,
    { body: { noEnv: true, ttlSeconds: config.ttlSeconds } },
  );
  if (resumed.kind !== "ok") {
    await record(ctx, op._id, {
      outcome: resumed.kind === "failed" ? "failed" : "uncertain",
      error: `resume ${resumed.kind}: ${resumed.detail}`,
    });
    return;
  }
  const ready = await waitForBoxReady(connection.boxRef);
  if (ready.kind !== "ok") {
    await record(ctx, op._id, {
      outcome: "uncertain",
      error: `post-resume readiness: ${ready.detail}`,
    });
    return;
  }
  // A disconnect committed while this resume was in flight wins: re-read
  // the connection. If it moved on WITHOUT keeping this box attached, stop
  // the just-resumed box rather than leave a live orphan; if a new
  // generation still references the same box (a reconnect-resume in
  // flight), leave it alone — the newer op owns it.
  const latest = (await ctx.runQuery(
    internal.runtimeConnections.getRuntimeConnection,
    { runtimeConnectionId: op.runtimeConnectionId },
  )) as Doc<"runtimeConnections"> | null;
  if (
    latest === null ||
    latest.generation !== op.runtimeGeneration ||
    latest.state === "stopping" ||
    latest.state === "stopped" ||
    latest.state === "disconnected"
  ) {
    if (latest === null || latest.boxRef !== connection.boxRef) {
      await asciiRequest(
        "POST",
        `/boxes/${encodeURIComponent(connection.boxRef)}/stop`,
        { body: {}, timeoutMs: 60_000 },
      );
    }
    await record(ctx, op._id, {
      outcome: "completed",
      boxRef: connection.boxRef,
      error:
        "connection moved on during resume; outcome recorded without touching it",
    });
    return;
  }
  // Rewrite worker.env with THIS generation's credential and re-run the
  // image setup — the persisted env predates the reconnect.
  const bootstrap = await bootstrapBox(connection.boxRef, env, config);
  await record(ctx, op._id, {
    outcome: bootstrap.ok ? "completed" : "uncertain",
    boxRef: connection.boxRef,
    connectionState: "connecting",
    ...(bootstrap.ok ? {} : { error: bootstrap.error ?? "bootstrap failed" }),
  });
}

async function runExtendTtl(
  ctx: ActionCtx,
  op: Doc<"runtimeLifecycleOperations">,
  connection: Doc<"runtimeConnections">,
): Promise<void> {
  if (connection.boxRef === undefined) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: "extend_ttl requested without a box reference",
    });
    return;
  }
  const config = op.requestConfig as LifecycleRequestConfig;
  const updated = await asciiRequest(
    "PATCH",
    `/boxes/${encodeURIComponent(connection.boxRef)}`,
    { body: { ttlSeconds: config.ttlSeconds } },
  );
  if (updated.kind !== "ok") {
    await record(ctx, op._id, {
      outcome: updated.kind === "failed" ? "failed" : "uncertain",
      error: `extend_ttl ${updated.kind}: ${updated.detail}`,
    });
    return;
  }
  await record(ctx, op._id, {
    outcome: "completed",
    boxRef: connection.boxRef,
  });
}

async function runStop(
  ctx: ActionCtx,
  op: Doc<"runtimeLifecycleOperations">,
  connection: Doc<"runtimeConnections">,
): Promise<void> {
  // The pinned target wins: a teardown issued for a box that a generation
  // bump later detached from the connection must still reach that box.
  const targetBoxRef = op.boxRef ?? connection.boxRef;
  const stillCurrent =
    targetBoxRef !== undefined && targetBoxRef === connection.boxRef;
  if (targetBoxRef === undefined) {
    // Nothing to stop — the intent is already satisfied.
    await record(ctx, op._id, {
      outcome: "completed",
      connectionState: "stopped",
    });
    return;
  }
  const stopped = await asciiRequest(
    "POST",
    `/boxes/${encodeURIComponent(targetBoxRef)}/stop`,
    { body: {} },
  );
  if (stopped.kind === "uncertain") {
    await record(ctx, op._id, {
      outcome: "uncertain",
      error: `stop uncertain: ${stopped.detail}`,
    });
    return;
  }
  if (stopped.kind === "failed" && stopped.status !== 404) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: `stop failed: ${stopped.detail}`,
    });
    return;
  }
  // 404 = box already gone — stop intent satisfied. Only claim the
  // connection transition when the stopped box is still the attached one.
  await record(ctx, op._id, {
    outcome: "completed",
    ...(stillCurrent ? { connectionState: "stopped" as const } : {}),
  });
}

async function runDelete(
  ctx: ActionCtx,
  op: Doc<"runtimeLifecycleOperations">,
  connection: Doc<"runtimeConnections">,
): Promise<void> {
  const targetBoxRef = op.boxRef ?? connection.boxRef;
  const stillCurrent =
    targetBoxRef !== undefined && targetBoxRef === connection.boxRef;
  if (targetBoxRef === undefined) {
    await record(ctx, op._id, {
      outcome: "completed",
      connectionState: "disconnected",
      clearBoxRef: true,
    });
    return;
  }
  const boxId = targetBoxRef;
  const deleted = await asciiRequest(
    "DELETE",
    `/boxes/${encodeURIComponent(boxId)}`,
    { confirmDeleteId: boxId, timeoutMs: 60_000 },
  );
  if (deleted.kind === "uncertain") {
    await record(ctx, op._id, {
      outcome: "uncertain",
      error: `delete uncertain: ${deleted.detail}`,
    });
    return;
  }
  if (deleted.kind === "failed" && deleted.status !== 404) {
    await record(ctx, op._id, {
      outcome: "failed",
      error: `delete failed: ${deleted.detail}`,
    });
    return;
  }
  if (deleted.kind === "ok") {
    const body = deleted.body as Record<string, unknown> | null;
    const operationId = body?.operationId as string | undefined;
    if (operationId !== undefined) {
      const done = await waitForDeletion(operationId, boxId);
      if (done.kind !== "ok") {
        await record(ctx, op._id, {
          outcome: "uncertain",
          boxRef: boxId,
          providerOperationRef: operationId,
          error: done.detail,
        });
        return;
      }
    }
  }
  await record(ctx, op._id, {
    outcome: "completed",
    ...(stillCurrent
      ? { connectionState: "disconnected" as const, clearBoxRef: true }
      : {}),
  });
}

async function waitForDeletion(
  operationId: string,
  boxId: string,
): Promise<{ kind: "ok" } | { kind: "uncertain"; detail: string }> {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const inspected = await asciiRequest(
      "GET",
      `/boxes/${encodeURIComponent(boxId)}`,
    );
    if (inspected.kind === "failed" && inspected.status === 404) {
      return { kind: "ok" };
    }
    const op = await asciiRequest(
      "GET",
      `/deletion-operations/${encodeURIComponent(operationId)}`,
    );
    if (op.kind === "ok") {
      const body = op.body as Record<string, unknown> | null;
      const status = body?.status as string | undefined;
      if (status === "done" || status === "completed" || status === "succeeded") {
        return { kind: "ok" };
      }
      if (status === "failed" || status === "error") {
        return { kind: "uncertain", detail: "deletion operation failed" };
      }
    }
    await sleep(ASCII_POLL_INTERVAL_MS);
  }
  return { kind: "uncertain", detail: "deletion poll timed out" };
}

async function record(
  ctx: ActionCtx,
  operationId: Id<"runtimeLifecycleOperations">,
  outcome: {
    outcome: "completed" | "failed" | "uncertain";
    boxRef?: string;
    providerOperationRef?: string;
    error?: string;
    connectionState?: string;
    clearBoxRef?: boolean;
  },
): Promise<void> {
  await ctx.runMutation(internal.runtimeConnections.recordLifecycleOutcome, {
    operationId,
    ...outcome,
  });
}

