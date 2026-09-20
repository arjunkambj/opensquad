/**
 * `reserveSendIntent` — §8 step 3, the serialization point.
 *
 * Durable intent plus every static gate, atomically. Outside the send window
 * or over the daily allowance it parks the attempt `reserved` with
 * `nextPermittedAt` instead of touching the provider.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import {
  domainError,
  sendWindowStatus,
  vSendAttemptState,
} from "../lib/validators";
import { blockResult } from "./sendDispatch";
import { evaluateSendGates, vSendBlockCode } from "./sendGates";
import {
  ensureUsageReservation,
  insertReservedAttempt,
  loadAttemptContext,
  nextWindowStart,
  sendCapacity,
} from "./sendModel";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/* ------------------------------------------------------------------ */
/* reserveSendIntent — the serialization point (§8 step 3)               */
/* ------------------------------------------------------------------ */
const vReserveResult = v.union(
  v.object({
    action: v.literal("ready"),
    sendAttemptId: v.id("sendAttempts"),
  }),
  v.object({
    action: v.literal("existing"),
    sendAttemptId: v.id("sendAttempts"),
    state: vSendAttemptState,
  }),
  v.object({
    action: v.literal("wait"),
    sendAttemptId: v.id("sendAttempts"),
    nextPermittedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("blocked"),
    code: vSendBlockCode,
    reason: v.string(),
  }),
);

/**
 * Atomically create the ONE logical send intent for a draft revision.
 *
 * - `send:<draftId>[:retry:N]` dedupes retried dispatch triggers — a replay
 *  returns the live attempt, a concurrently racing trigger either observes
 *  the committed attempt (idempotent) or aborts and re-reads.
 * - Every static gate runs inside the transaction; a hard block writes an
 *  activity record and returns `blocked` — no attempt row is created for an
 *  intent that can never dispatch.
 * - Outside the send window or over the daily limit the attempt is created
 *  `reserved` with `nextPermittedAt` — durable intent BEFORE any network
 *  I/O — and the caller waits durably and re-runs everything.
 * - The daily-send usage reservation is taken here when dispatch is
 *  imminent (inside the window); a window-parked attempt reserves at
 *  `beginDispatch` so a wait never debits the wrong local day.
 */
export const reserveSendIntent = internalMutation({
  args: {
    draftId: v.id("drafts"),
  },
  returns: vReserveResult,
  handler: async (ctx, args): Promise<Infer<typeof vReserveResult>> => {
    const context = await loadAttemptContext(ctx, args.draftId);
    const { draft, workspace, conversation } = context;

    // --- logical-send dedupe ------------------------------------------------
    const priorAttempts = await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
      .collect();
    const live = priorAttempts.find(
      (attempt) =>
        attempt.state === "reserved" || attempt.state === "requesting",
    );
    if (live !== undefined) {
      return {
        action: "existing" as const,
        sendAttemptId: live._id,
        state: live.state,
      };
    }
    if (priorAttempts.some((attempt) => attempt.state === "acknowledged")) {
      return blockResult("already_sent", "draft revision already sent");
    }
    if (priorAttempts.some((attempt) => attempt.state === "uncertain")) {
      return blockResult(
        "attempt_uncertain",
        "an earlier attempt for this revision is still uncertain — reconcile it before sending again; never blind-retry",
      );
    }
    if (
      priorAttempts.some(
        (attempt) => attempt.state === "definitively_failed",
      )
    ) {
      return blockResult(
        "attempt_failed",
        "this exact payload was already definitively refused — a corrected draft revision is required",
      );
    }
    const operationKey =
      priorAttempts.length === 0
        ? `send:${draft._id}`
        : `send:${draft._id}:retry:${priorAttempts.length}`;

    // --- static gates ---------------------------------------------------------
    const gate = await evaluateSendGates(ctx, {
      workspace: context.workspace,
      conversation,
      draft,
      agent: context.agent,
    });
    if (!gate.ok) {
      await recordActivityEvent(ctx, {
        workspaceId: workspace._id,
        kind: "send_attempt_cancelled",
        summary: `Send blocked (${gate.code}): ${gate.reason}`,
        actor: "workflow",
        dedupeKey: `sendblock:${draft._id}:${gate.code}:${operationKey}`,
        conversationId: conversation._id,
      });
      return blockResult(gate.code, gate.reason);
    }

    const now = Date.now();

    // --- send window ----------------------------------------------------------
    const window = sendWindowStatus(workspace, now);
    if (!window.permitted) {
      const sendAttemptId = await insertReservedAttempt(ctx, {
        context,
        approval: gate.approval,
        operationKey,
        nextPermittedAt: window.nextPermittedAt,
      });
      // Scheduled INSIDE the committing mutation — the durable wake can
      // never be lost between the `reserved` write and a caller-side
      // schedule (the action may die in between).
      await ctx.scheduler.runAfter(
        Math.max(0, window.nextPermittedAt - now),
        internal.outreach.sendActions.dispatchAttempt,
        { sendAttemptId },
      );
      return {
        action: "wait" as const,
        sendAttemptId,
        nextPermittedAt: window.nextPermittedAt,
        reason: "outside_window",
      };
    }

    // --- daily allowance -------------------------------------------------------
    const capacity = await sendCapacity(ctx, workspace, now);
    if (capacity.remaining < 1) {
      const nextPermittedAt = nextWindowStart(workspace, now);
      const sendAttemptId = await insertReservedAttempt(ctx, {
        context,
        approval: gate.approval,
        operationKey,
        nextPermittedAt,
      });
      await ctx.scheduler.runAfter(
        Math.max(0, nextPermittedAt - now),
        internal.outreach.sendActions.dispatchAttempt,
        { sendAttemptId },
      );
      return {
        action: "wait" as const,
        sendAttemptId,
        nextPermittedAt,
        reason: "send_limit_reached",
      };
    }

    // --- reserve intent + allowance atomically ---------------------------------
    // `nextPermittedAt: now` — dispatch is permitted immediately, and the
    // belt sweep can re-drive this row if the caller dies between the
    // commit and beginDispatch (an unindexed reserved row would park
    // forever).
    const sendAttemptId = await insertReservedAttempt(ctx, {
      context,
      approval: gate.approval,
      operationKey,
      nextPermittedAt: now,
    });
    const attempt = await ctx.db.get("sendAttempts", sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found after insert");
    }
    await ensureUsageReservation(ctx, attempt, workspace);
    return { action: "ready" as const, sendAttemptId };
  },
});
