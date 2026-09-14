/**
 * Owner control channel (P07 — architecture §3.2 "Owner Control Channel").
 *
 * Owner-issued commands — inspect_account / start_login / cancel_login /
 * logout / interrupt_turn — ride a separate claim path from model work
 * (`POST /worker/control/claim`) so they are never blocked by a busy model
 * slot. Commands are idempotent by (workspaceId, requestId), expire quickly,
 * and produce sanitized `safeResult` summaries only. Login challenge
 * material (verification URL + user code) lives in `runtimeLoginChallenges`
 * — owner-only, short-lived, deleted on completion/cancellation/expiry, and
 * never written to activity or board feeds.
 */
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceOwner } from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  CONTROL_REQUEST_TTL_MS,
  domainError,
  invalid,
  mintBridgeRequestId,
  vControlCommand,
} from "./lib/validators";
import type { ControlCommand } from "./lib/validators";

/**
 * At most one outstanding `start_login` per runtime. A `cancel_login` must
 * be able to coexist with the claimed `start_login` it cancels, so the
 * exclusivity rule applies to start_login only.
 */
const EXCLUSIVE_COMMANDS: readonly ControlCommand[] = ["start_login"];

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

/**
 * Enqueue a control command (shared by owner mutations and internal paths).
 * Idempotent on (workspaceId, requestId); at most one outstanding login
 * command per runtime; commands stamped with the connection's CURRENT
 * generation — a stale generation can never be claimed.
 */
async function enqueueControlCommand(
  ctx: MutationCtx,
  args: {
    connection: Doc<"runtimeConnections">;
    command: ControlCommand;
    requestId: string;
    requestedBy: string;
    loginId?: string;
    turnId?: string;
    threadId?: string;
    ttlMs?: number;
  },
): Promise<{ controlRequestId: Id<"runtimeControlRequests">; requestId: string; deduplicated: boolean }> {
  const existing = await ctx.db
    .query("runtimeControlRequests")
    .withIndex("by_workspaceId_and_requestId", (q) =>
      q
        .eq("workspaceId", args.connection.workspaceId)
        .eq("requestId", args.requestId),
    )
    .unique();
  if (existing !== null) {
    return {
      controlRequestId: existing._id,
      requestId: args.requestId,
      deduplicated: true,
    };
  }

  // Only live states — the connection-prefix alone would re-read the row's
  // entire lifetime history on every enqueue.
  const outstanding: Doc<"runtimeControlRequests">[] = [];
  for (const state of ["pending", "claimed"] as const) {
    outstanding.push(
      ...(await ctx.db
        .query("runtimeControlRequests")
        .withIndex("by_runtimeConnectionId_and_state", (q) =>
          q
            .eq("runtimeConnectionId", args.connection._id)
            .eq("state", state),
        )
        .collect()),
    );
  }
  const live = outstanding.filter(
    (request) => request.expiresAt > Date.now(),
  );

  // One outstanding command of the same kind AND payload is a replay, not
  // an error — an interrupt_turn for turn B must not dedupe onto turn A's
  // still-live request and silently never reach B.
  const sameKind = live.find(
    (request) =>
      request.command === args.command &&
      request.turnId === args.turnId &&
      request.threadId === args.threadId &&
      request.loginId === args.loginId,
  );
  if (sameKind !== undefined) {
    return {
      controlRequestId: sameKind._id,
      requestId: sameKind.requestId,
      deduplicated: true,
    };
  }
  if (
    EXCLUSIVE_COMMANDS.includes(args.command) &&
    live.some((request) => EXCLUSIVE_COMMANDS.includes(request.command))
  ) {
    throw domainError(
      "CONFLICT",
      "a start_login command is already outstanding for this runtime",
    );
  }

  const now = Date.now();
  const controlRequestId = await ctx.db.insert("runtimeControlRequests", {
    workspaceId: args.connection.workspaceId,
    runtimeConnectionId: args.connection._id,
    runtimeGeneration: args.connection.generation,
    requestId: args.requestId,
    command: args.command,
    state: "pending",
    requestedBy: args.requestedBy,
    expiresAt: now + (args.ttlMs ?? CONTROL_REQUEST_TTL_MS),
    createdAt: now,
    ...(args.loginId !== undefined ? { loginId: args.loginId } : {}),
    ...(args.turnId !== undefined ? { turnId: args.turnId } : {}),
    ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
  });
  return { controlRequestId, requestId: args.requestId, deduplicated: false };
}

/** Reusable internal path (e.g. disconnect enqueues logout). */
export const enqueueInternal = internalMutation({
  args: {
    runtimeConnectionId: v.id("runtimeConnections"),
    command: vControlCommand,
    requestId: v.string(),
    loginId: v.optional(v.string()),
    turnId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(
      "runtimeConnections",
      args.runtimeConnectionId,
    );
    if (connection === null) {
      throw domainError("NOT_FOUND", "runtime connection not found");
    }
    return await enqueueControlCommand(ctx, {
      connection,
      command: args.command,
      requestId: args.requestId,
      requestedBy: "system",
      ...(args.loginId !== undefined ? { loginId: args.loginId } : {}),
      ...(args.turnId !== undefined ? { turnId: args.turnId } : {}),
      ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
      ...(args.ttlMs !== undefined ? { ttlMs: args.ttlMs } : {}),
    });
  },
});

/* ------------------------------------------------------------------ */
/* Owner mutations                                                       */
/* ------------------------------------------------------------------ */

const vCommandArgs = {
  workspaceId: v.id("workspaces"),
  requestId: v.optional(v.string()),
};

/**
 * Ask the runtime to report its Codex account state (owner). Safe to repeat;
 * a still-live identical command is returned instead of duplicated.
 */
export const requestAccountInspection = mutation({
  args: vCommandArgs,
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    return await enqueueControlCommand(ctx, {
      connection,
      command: "inspect_account",
      requestId: args.requestId ?? mintBridgeRequestId(),
      requestedBy: identityKey,
    });
  },
});

/**
 * Begin managed Codex login inside the workspace Box (owner). The worker
 * claims this, runs `account/login/start`, and reports the device-code
 * challenge — which lands in `runtimeLoginChallenges` and is readable only
 * through `getLoginChallenge` until it completes or expires.
 */
export const startLogin = mutation({
  args: vCommandArgs,
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    if (
      connection.state === "disconnected" ||
      connection.state === "stopped" ||
      connection.state === "stopping" ||
      connection.state === "error"
    ) {
      throw domainError(
        "CONFLICT",
        `runtime connection is ${connection.state}; reconnect before starting login`,
      );
    }
    return await enqueueControlCommand(ctx, {
      connection,
      command: "start_login",
      requestId: args.requestId ?? mintBridgeRequestId(),
      requestedBy: identityKey,
    });
  },
});

/**
 * Cancel a pending login (owner). Expires an unclaimed start_login request
 * outright; a claimed one gets a `cancel_login` command carrying the loginId
 * so the worker calls `account/login/cancel`. Either way the challenge row
 * is deleted.
 */
export const cancelLogin = mutation({
  args: vCommandArgs,
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    const now = Date.now();

    // Retire any live start_login request first: an unclaimed one expires
    // outright; a claimed one is cancelled at the worker via the command
    // we enqueue below (carrying its loginId). Live states only — never
    // scan the connection's lifetime control history.
    const outstanding: Doc<"runtimeControlRequests">[] = [];
    for (const state of ["pending", "claimed"] as const) {
      outstanding.push(
        ...(await ctx.db
          .query("runtimeControlRequests")
          .withIndex("by_runtimeConnectionId_and_state", (q) =>
            q
              .eq("runtimeConnectionId", connection._id)
              .eq("state", state),
          )
          .collect()),
      );
    }
    const liveStartLogin = outstanding.find(
      (request) =>
        request.command === "start_login" && request.expiresAt > now,
    );
    // Challenges for this connection never survive a cancel.
    const challenges = await ctx.db
      .query("runtimeLoginChallenges")
      .withIndex("by_runtimeConnectionId", (q) =>
        q.eq("runtimeConnectionId", connection._id),
      )
      .collect();
    for (const challenge of challenges) {
      await ctx.db.delete("runtimeLoginChallenges", challenge._id);
    }
    if (liveStartLogin === undefined) {
      throw domainError("CONFLICT", "no login is in progress to cancel");
    }
    if (liveStartLogin.state === "pending") {
      await ctx.db.patch("runtimeControlRequests", liveStartLogin._id, {
        state: "expired",
      });
      return {
        controlRequestId: liveStartLogin._id,
        requestId: liveStartLogin.requestId,
        deduplicated: true,
      };
    }
    return await enqueueControlCommand(ctx, {
      connection,
      command: "cancel_login",
      requestId: args.requestId ?? mintBridgeRequestId(),
      requestedBy: identityKey,
      ...(liveStartLogin.loginId !== undefined
        ? { loginId: liveStartLogin.loginId }
        : {}),
    });
  },
});

/**
 * Ask the runtime to interrupt the currently recorded turn (owner/system).
 * This is the termination-confirmation path: the worker reports back
 * whether the turn actually stopped, and only then may an uncertain slot be
 * released.
 */
export const interruptActiveTurn = mutation({
  args: vCommandArgs,
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    const ref = connection.currentCodexTurnRef;
    if (ref === undefined || ref === "") {
      throw invalid("no active Codex turn is recorded on this runtime");
    }
    const [threadId, turnId] = ref.split(":");
    if (turnId === undefined || turnId === "") {
      throw invalid("recorded Codex turn reference is malformed");
    }
    return await enqueueControlCommand(ctx, {
      connection,
      command: "interrupt_turn",
      requestId: args.requestId ?? mintBridgeRequestId(),
      requestedBy: identityKey,
      turnId,
      ...(threadId !== undefined && threadId !== "" ? { threadId } : {}),
    });
  },
});

/** Ask the runtime to log the managed Codex account out (owner). */
export const logoutAccount = mutation({
  args: vCommandArgs,
  returns: v.object({
    controlRequestId: v.id("runtimeControlRequests"),
    requestId: v.string(),
    deduplicated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await getConnectionInWorkspace(ctx, args.workspaceId);
    return await enqueueControlCommand(ctx, {
      connection,
      command: "logout",
      requestId: args.requestId ?? mintBridgeRequestId(),
      requestedBy: identityKey,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                               */
/* ------------------------------------------------------------------ */

/**
 * The current login challenge for the workspace's runtime (owner only).
 * Returns null when absent or expired — expired rows are also deleted by the
 * sweep, and completion/cancellation deletes them immediately.
 */
export const getLoginChallenge = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(
    v.object({
      verificationUrl: v.string(),
      userCode: v.string(),
      expiresAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await ctx.db
      .query("runtimeConnections")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (connection === null) {
      return null;
    }
    const challenges = await ctx.db
      .query("runtimeLoginChallenges")
      .withIndex("by_runtimeConnectionId", (q) =>
        q.eq("runtimeConnectionId", connection._id),
      )
      .collect();
    const live = challenges.find((row) => row.expiresAt > Date.now());
    if (live === undefined) {
      return null;
    }
    return {
      verificationUrl: live.verificationUrl,
      userCode: live.userCode,
      expiresAt: live.expiresAt,
    };
  },
});

/** Outstanding (pending/claimed) control requests — owner diagnostics. */
export const listOutstanding = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(
    v.object({
      controlRequestId: v.id("runtimeControlRequests"),
      command: v.string(),
      state: v.string(),
      requestId: v.string(),
      expiresAt: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceOwner(ctx, args.workspaceId);
    const connection = await ctx.db
      .query("runtimeConnections")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .unique();
    if (connection === null) {
      return [];
    }
    const rows: Doc<"runtimeControlRequests">[] = [];
    for (const state of ["pending", "claimed"] as const) {
      rows.push(
        ...(await ctx.db
          .query("runtimeControlRequests")
          .withIndex("by_runtimeConnectionId_and_state", (q) =>
            q
              .eq("runtimeConnectionId", connection._id)
              .eq("state", state),
          )
          .collect()),
      );
    }
    return rows
      .filter((request) => request.expiresAt > Date.now())
      .map((request) => ({
        controlRequestId: request._id,
        command: request.command,
        state: request.state,
        requestId: request.requestId,
        expiresAt: request.expiresAt,
        createdAt: request.createdAt,
      }));
  },
});
