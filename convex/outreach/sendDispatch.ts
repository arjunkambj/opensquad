/**
 * `beginDispatch` — §8 step 4, THE COMMIT POINT.
 *
 * A guarded mutation that re-runs every send gate, takes the usage
 * reservation and flips the attempt `reserved → requesting` in ONE
 * transaction, then returns the exact immutable send payload rebuilt from the
 * draft row. The very next statement in the calling action performs the
 * single provider request; after this point nothing local can retract it.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import {
  domainError,
  localDayKey,
  sendWindowStatus,
  vSendAttemptState,
} from "../lib/validators";
import { evaluateSendGates, vSendBlockCode } from "./sendGates";
import type { SendBlockCode } from "./sendGates";
import {
  ensureUsageReservation,
  loadAttemptContext,
  nextWindowStart,
  REQUEST_STALE_SWEEP_MS,
  sendCapacity,
} from "./sendModel";
import { v } from "convex/values";
import type { Infer } from "convex/values";

export function blockResult(
  code: SendBlockCode,
  reason: string,
): { action: "blocked"; code: SendBlockCode; reason: string } {
  return { action: "blocked", code, reason };
}

/* ------------------------------------------------------------------ */
/* beginDispatch — the commit point (§8 step 4)                          */
/* ------------------------------------------------------------------ */
export const vSendPayload = v.object({
  to: v.string(),
  subject: v.optional(v.string()),
  text: v.string(),
});

const vBeginResult = v.union(
  v.object({
    action: v.literal("dispatch"),
    sendAttemptId: v.id("sendAttempts"),
    /** Whose key the request is made with — there is no platform key. */
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    providerIdempotencyKey: v.string(),
    endpointOperation: v.union(v.literal("send"), v.literal("reply")),
    parentMessageId: v.optional(v.string()),
    payloadHash: v.string(),
    payload: vSendPayload,
  }),
  v.object({
    action: v.literal("wait"),
    nextPermittedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("blocked"),
    code: vSendBlockCode,
    reason: v.string(),
  }),
  v.object({
    action: v.literal("done"),
    state: vSendAttemptState,
  }),
);

/**
 * Immediately-before-submission gate: re-runs EVERY check against live data,
 * ensures the usage reservation exists and flips `reserved → requesting`
 * atomically, then returns the exact immutable payload rebuilt from the
 * draft row (never re-read after this transaction). A second caller on a
 * `requesting` attempt gets `blocked: attempt_in_flight` — there is exactly
 * one in-flight provider request per attempt, ever.
 */
export const beginDispatch = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vBeginResult,
  handler: async (ctx, args): Promise<Infer<typeof vBeginResult>> => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state === "acknowledged") {
      return { action: "done" as const, state: attempt.state };
    }
    if (attempt.state !== "reserved") {
      return {
        action: "blocked" as const,
        code: "attempt_in_flight" as const,
        reason: `attempt is ${attempt.state}; dispatch can only start from reserved`,
      };
    }

    const context = await loadAttemptContext(ctx, attempt.draftId);
    const { workspace, conversation, draft } = context;
    const gate = await evaluateSendGates(ctx, {
      workspace,
      conversation,
      draft,
      agent: context.agent,
      excludeAttemptId: attempt._id,
    });
    const cancel = async (code: SendBlockCode, reason: string) => {
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "cancelled",
        error: { message: reason, at: Date.now(), reason: code },
        updatedAt: Date.now(),
      });
      // Release any deferred reservation the parked attempt holds.
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation !== null && reservation.state === "reserved") {
        await ctx.runMutation(internal.billing.reservations.release, {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        });
      }
      await recordActivityEvent(ctx, {
        workspaceId: workspace._id,
        kind: "send_attempt_cancelled",
        summary: `Send cancelled at dispatch gate (${code}): ${reason}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:cancelled`,
        conversationId: conversation._id,
      });
      return blockResult(code, reason);
    };
    if (!gate.ok) {
      return await cancel(gate.code, gate.reason);
    }

    const now = Date.now();
    const window = sendWindowStatus(workspace, now);
    if (!window.permitted) {
      await ctx.db.patch("sendAttempts", attempt._id, {
        nextPermittedAt: window.nextPermittedAt,
        updatedAt: now,
      });
      // Transactional wake — the parked attempt's re-drive cannot be lost.
      await ctx.scheduler.runAfter(
        Math.max(0, window.nextPermittedAt - now),
        internal.outreach.sendActions.dispatchAttempt,
        { sendAttemptId: attempt._id },
      );
      return {
        action: "wait" as const,
        nextPermittedAt: window.nextPermittedAt,
        reason: "outside_window",
      };
    }
    let reservation: Doc<"usageReservations"> | null = await ctx.runMutation(
      internal.billing.reservations.getByOperationKey,
      {
        workspaceId: workspace._id,
        operationKey: attempt.operationKey,
      },
    );
    if (reservation !== null && reservation.state === "reserved") {
      // A reservation taken on a previous local day must not fund today's
      // send — release it and re-reserve under the current period so the
      // daily cap is charged to the day the mail actually goes out.
      const heldBucket = await ctx.db.get("usageBuckets", reservation.bucketId);
      if (
        heldBucket !== null &&
        heldBucket.periodKey !== localDayKey(now, workspace.timezone)
      ) {
        await ctx.runMutation(internal.billing.reservations.release, {
          workspaceId: workspace._id,
          operationKey: attempt.operationKey,
        });
        reservation = null;
      }
    }
    if (reservation === null) {
      const capacity = await sendCapacity(ctx, workspace, now);
      if (capacity.remaining < 1) {
        const nextPermittedAt = nextWindowStart(workspace, now);
        await ctx.db.patch("sendAttempts", attempt._id, {
          nextPermittedAt,
          updatedAt: now,
        });
        await ctx.scheduler.runAfter(
          Math.max(0, nextPermittedAt - now),
          internal.outreach.sendActions.dispatchAttempt,
          { sendAttemptId: attempt._id },
        );
        return {
          action: "wait" as const,
          nextPermittedAt,
          reason: "send_limit_reached",
        };
      }
      await ensureUsageReservation(ctx, attempt, workspace);
    } else if (reservation.state !== "reserved") {
      return {
        action: "blocked" as const,
        code: "unresolved_attempt" as const,
        reason: `usage reservation is ${reservation.state}; cannot dispatch`,
      };
    }

    // Commit point — after this patch the request may be in flight and can
    // no longer be retracted by local state. The lost-acknowledgement sweep
    // is scheduled in the SAME transaction: a `requesting` row always has a
    // recovery path even if the calling action dies before returning.
    await ctx.db.patch("sendAttempts", attempt._id, {
      state: "requesting",
      requestStartedAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      REQUEST_STALE_SWEEP_MS,
      internal.outreach.sendSweeps.sweepStaleRequesting,
      { sendAttemptId: attempt._id },
    );
    await recordActivityEvent(ctx, {
      workspaceId: workspace._id,
      kind: "send_attempt_dispatched",
      summary: `Dispatching draft revision ${draft.revision} to provider`,
      actor: "workflow",
      dedupeKey: `sendattempt:${attempt._id}:dispatched`,
      conversationId: conversation._id,
    });
    return {
      action: "dispatch" as const,
      sendAttemptId: attempt._id,
      workspaceId: workspace._id,
      inboxRef: draft.inboxRef,
      providerIdempotencyKey: attempt.providerIdempotencyKey,
      endpointOperation: attempt.endpointOperation,
      parentMessageId: draft.replyToMessageRef,
      payloadHash: attempt.payloadHash,
      payload: {
        to: draft.normalizedRecipient,
        ...(draft.subject.length > 0 ? { subject: draft.subject } : {}),
        text: draft.body,
      },
    };
  },
});
