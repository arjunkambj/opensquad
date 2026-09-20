/**
 * Loaders, limits and the reservation/attempt inserts the send boundary is
 * built from. Plain typed functions over `ctx` — the Convex functions beside
 * this file hold the transaction boundaries, not the logic.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import {
  domainError,
  localCivilToUtc,
  localDayKey,
  localDayParts,
  sendWindowStatus,
} from "../lib/validators";

/* ------------------------------------------------------------------ */
/* Constants + result vocabulary                                        */
/* ------------------------------------------------------------------ */
/**
 * Longer than the adapter's 30s provider timeout plus margin — a `requesting`
 * attempt older than this means the action died between dispatch and outcome
 * recording (a lost acknowledgement), which is treated as `uncertain`.
 */
export const REQUEST_STALE_SWEEP_MS = 120_000;

/**
 * Replay window for an uncertain attempt. AgentMail retains idempotency keys
 * for 24h; we stop replaying well inside that so a late replay can never
 * mint a duplicate after the key expired.
 */
export const RECONCILE_WINDOW_MS = 23 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Loaders + helpers                                                    */
/* ------------------------------------------------------------------ */
type AttemptContext = {
  workspace: Doc<"workspaces">;
  conversation: Doc<"conversations">;
  draft: Doc<"drafts">;
  agent: Doc<"agents"> | null;
};

export async function loadAttemptContext(
  ctx: MutationCtx,
  draftId: Id<"drafts">,
): Promise<AttemptContext> {
  const draft = await ctx.db.get("drafts", draftId);
  if (draft === null) {
    throw domainError("NOT_FOUND", "draft not found");
  }
  const conversation = await ctx.db.get("conversations", draft.conversationId);
  const workspace = await ctx.db.get("workspaces", draft.workspaceId);
  if (conversation === null || workspace === null) {
    throw domainError("NOT_FOUND", "send context is incomplete");
  }
  const agent =
    conversation.agentId === undefined
      ? null
      : await ctx.db.get("agents", conversation.agentId);
  return { workspace, conversation, draft, agent };
}

/** The workspace's daily send cap — the one ceiling the ledger reserves against. */
export function effectiveSendLimit(workspace: Doc<"workspaces">): number {
  return workspace.dailySendLimit;
}

/** UTC instant of the NEXT send-window opening after `fromMs`. */
export function nextWindowStart(
  workspace: Doc<"workspaces">,
  fromMs: number,
): number {
  const status = sendWindowStatus(workspace, fromMs);
  if (!status.permitted) {
    return status.nextPermittedAt;
  }
  // Already inside a window — the next opening follows today's close. Find
  // the close instant in local civil time, then ask for the opening after it.
  const parts = localDayParts(fromMs, workspace.timezone);
  const closeUtc = localCivilToUtc(
    parts.year,
    parts.month,
    parts.day,
    workspace.sendWindow.endMinute,
    workspace.timezone,
  );
  const after = sendWindowStatus(workspace, closeUtc + 60_000);
  return after.permitted ? closeUtc + 60_000 : after.nextPermittedAt;
}

/** Remaining send capacity for the workspace-local day containing `atMs`. */
export async function sendCapacity(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  atMs: number,
): Promise<{ periodKey: string; limit: number; remaining: number }> {
  const periodKey = localDayKey(atMs, workspace.timezone);
  const limit = effectiveSendLimit(workspace);
  const bucket = await ctx.db
    .query("usageBuckets")
    .withIndex(
      "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
      (q) =>
        q
          .eq("workspaceId", workspace._id)
          .eq("scopeKey", "workspace")
          .eq("metric", "sends")
          .eq("periodKey", periodKey),
    )
    .unique();
  const used =
    bucket === null
      ? 0
      : bucket.reserved + bucket.committed + bucket.uncertain;
  return { periodKey, limit, remaining: limit - used };
}

/**
 * Take the daily-send reservation for this attempt. Idempotent on the
 * attempt's `operationKey`; a true capacity race surfaces as CONFLICT from
 * the nested mutation, which aborts this transaction — the calling action
 * then re-runs `reserveSendIntent` and lands on the `wait` path.
 */
export async function ensureUsageReservation(
  ctx: MutationCtx,
  attempt: Doc<"sendAttempts">,
  workspace: Doc<"workspaces">,
): Promise<void> {
  const now = Date.now();
  const capacity = await sendCapacity(ctx, workspace, now);
  if (capacity.remaining < 1) {
    throw domainError(
      "CONFLICT",
      `send limit reached for ${capacity.periodKey} (${capacity.limit})`,
    );
  }
  await ctx.runMutation(internal.billing.reservations.reserve, {
    workspaceId: workspace._id,
    scopeKey: "workspace",
    metric: "sends",
    periodKey: capacity.periodKey,
    limit: capacity.limit,
    operationKey: attempt.operationKey,
    quantity: 1,
  });
}

export async function insertReservedAttempt(
  ctx: MutationCtx,
  args: {
    context: AttemptContext;
    approval: Doc<"approvals">;
    operationKey: string;
    /** Recorded wake time for a parked attempt — set by the wait branches
     *  so the sweep can re-drive a lost schedule. */
    nextPermittedAt?: number;
  },
): Promise<Id<"sendAttempts">> {
  const { draft, conversation, workspace } = args.context;
  const now = Date.now();
  // The provider idempotency key is generated exactly once here and never
  // regenerated — the same key carries the initial request and every
  // reconciliation replay (G3).
  const providerIdempotencyKey = `opensquad-send-${crypto.randomUUID()}`;
  const attemptId = await ctx.db.insert("sendAttempts", {
    workspaceId: workspace._id,
    draftId: draft._id,
    approvalId: args.approval._id,
    conversationId: conversation._id,
    inboxRef: draft.inboxRef,
    operationKey: args.operationKey,
    endpointOperation:
      draft.replyToMessageRef === undefined ? "send" : "reply",
    providerIdempotencyKey,
    state: "reserved",
    payloadHash: draft.payloadHash,
    createdAt: now,
    updatedAt: now,
    ...(args.nextPermittedAt !== undefined
      ? { nextPermittedAt: args.nextPermittedAt }
      : {}),
  });
  await recordActivityEvent(ctx, {
    workspaceId: workspace._id,
    kind: "send_attempt_reserved",
    summary: `Send intent reserved for draft revision ${draft.revision} → ${draft.normalizedRecipient}`,
    actor: "workflow",
    dedupeKey: `sendattempt:${attemptId}:reserved`,
    conversationId: conversation._id,
  });
  return attemptId;
}
