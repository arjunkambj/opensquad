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
  boundedString,
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
import type { WorkerOperation } from "./lib/validators";
import type { MutationCtx } from "./_generated/server";

/* ------------------------------------------------------------------ */
/* Dispatch — called by workflow steps (and the dev seeder)              */
/* ------------------------------------------------------------------ */

const DISPATCHABLE_RUNTIME_STATES = new Set([
  "provisioning",
  "connecting",
  "ready",
]);

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
  handler: async (ctx, args) => {
    const mission = await ctx.db.get("missions", args.missionId);
    if (mission === null) {
      throw domainError("NOT_FOUND", "mission not found");
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
      inputRef: { kind: "inline", value: args.input },
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
  },
});

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
        // after confirmed interruption).
        const connection = await ctx.db.get(
          "runtimeConnections",
          request.runtimeConnectionId,
        );
        if (
          connection !== null &&
          connection.generation === request.runtimeGeneration &&
          (connection.currentCodexTurnRef ?? "") !== ""
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
          if (!hasInterrupt && turnId !== undefined && turnId !== "") {
            await ctx.db.insert("runtimeControlRequests", {
              workspaceId: request.workspaceId,
              runtimeConnectionId: connection._id,
              runtimeGeneration: request.runtimeGeneration,
              requestId: `sys-interrupt:${request._id}:${turnId}`,
              command: "interrupt_turn",
              state: "pending",
              requestedBy: "system",
              expiresAt: now + CONTROL_REQUEST_TTL_MS,
              createdAt: now,
              turnId,
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
        await ctx.db.patch("workerRequests", request._id, {
          state: "cancelled",
          error: {
            code: staleGeneration ? "stale_generation" : "mission_terminal",
            message: staleGeneration
              ? "request predates the current runtime generation"
              : "mission terminated before dispatch",
          },
          updatedAt: now,
        });
        cancelledRequests += 1;
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
    const scoutId = await ctx.db.insert("employees", {
      workspaceId,
      template: "scout",
      name: "Scout",
      instructions: "Fixture scout",
      instructionVersion: 1,
      enabled: true,
      allowedCapabilities: [],
      updatedAt: now,
    });
    const campaignId = await ctx.db.insert("campaigns", {
      workspaceId,
      title: "Bridge fixture campaign",
      brief: "Fixture brief",
      briefVersion: 1,
      sourcePlan,
      leadLimit: 5,
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
            employeeId: scoutId,
            template: "scout",
            name: "Scout",
            instructionVersion: 1,
          },
        ],
        policyVersion: 1,
        requestedOutcome: "Fixture outcome",
      },
      inputVersion: 1,
      priority: "normal",
      assignedEmployeeId: scoutId,
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
      employeeId: scoutId,
    });
    const operation: WorkerOperation = args.operation ?? "research";
    const dispatch = await dispatchWorkerRequestHandler(ctx, {
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

async function dispatchWorkerRequestHandler(
  ctx: MutationCtx,
  args: {
    missionId: Id<"missions">;
    runId: Id<"runs">;
    stepKey: string;
    generation: number;
    operation: WorkerOperation;
    input: unknown;
    outputSchemaVersion: number;
    targetWorkflowId: string;
    workflowGeneration: number;
  },
): Promise<{ workerRequestId: Id<"workerRequests">; continuationEventId: string }> {
  const mission = await ctx.db.get("missions", args.missionId);
  if (mission === null) {
    throw domainError("NOT_FOUND", "mission not found");
  }
  assertWorkerRequestInput(args.input);
  const connection = await ctx.db
    .query("runtimeConnections")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", mission.workspaceId))
    .unique();
  if (connection === null) {
    throw domainError("CONFLICT", "workspace has no runtime connection");
  }
  const existing = await ctx.db
    .query("workerRequests")
    .withIndex("by_missionId_and_stepKey_and_generation", (q) =>
      q
        .eq("missionId", args.missionId)
        .eq("stepKey", args.stepKey)
        .eq("generation", args.generation),
    )
    .unique();
  if (existing !== null) {
    return {
      workerRequestId: existing._id,
      continuationEventId: existing.continuationEventId,
    };
  }
  const continuationEventId = await createEvent(ctx, components.workflow, {
    name: `worker:${args.operation}:${args.stepKey}`,
    workflowId: args.targetWorkflowId as WorkflowId,
  });
  const now = Date.now();
  const workerRequestId = await ctx.db.insert("workerRequests", {
    workspaceId: mission.workspaceId,
    runtimeConnectionId: connection._id,
    runtimeGeneration: connection.generation,
    missionId: args.missionId,
    runId: args.runId,
    stepKey: args.stepKey,
    generation: args.generation,
    operation: args.operation,
    state: "pending",
    inputRef: { kind: "inline", value: args.input },
    outputSchemaVersion: args.outputSchemaVersion,
    targetWorkflowId: args.targetWorkflowId,
    continuationEventId,
    workflowGeneration: args.workflowGeneration,
    createdAt: now,
    updatedAt: now,
  });
  return { workerRequestId, continuationEventId };
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
    const runId = await insertRun(ctx, {
      missionId: mission._id,
      stage: "bridge_fixture",
      generation: 1,
      inputVersion: mission.inputVersion,
      inputSummary: "Bridge fixture request",
      employeeId: mission.assignedEmployeeId,
    });
    const operation: WorkerOperation = args.operation ?? "draft";
    const dispatch = await dispatchWorkerRequestHandler(ctx, {
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
      targetWorkflowId: mission.workflowId ?? "",
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
      loginChallenges: challenges.map((c) => ({
        _id: c._id,
        verificationUrl: c.verificationUrl,
        userCode: c.userCode,
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
