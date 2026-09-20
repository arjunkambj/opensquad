/**
 * The dispatch actions — §8 steps 4–7, single-flight and never retried.
 *
 * `dispatchAttempt` runs `beginDispatch` (the commit point) → ONE `runAction`
 * against the provider adapter → `recordSendOutcome`. No retry anywhere: not
 * here, not in the adapter, not via the component's sender.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * The action-level contract — also the return shape `workflows/send.ts`'s
 * journaled step consumes. `preflight_refused` covers every gate failure;
 * `outside_send_window` + `nextPermittedAt` is the only case a caller may
 * wait-and-retry on (the workflow sleeps durably; the non-workflow path
 * parks via `dispatchAttempt`). `acknowledged` is provider acceptance only —
 * never "delivered".
 */
export const vDispatchOutcome = v.union(
  v.object({
    outcome: v.literal("acknowledged"),
    sendAttemptId: v.id("sendAttempts"),
    providerMessageRef: v.string(),
    providerThreadRef: v.string(),
  }),
  v.object({
    outcome: v.literal("definitively_failed"),
    sendAttemptId: v.id("sendAttempts"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("uncertain"),
    sendAttemptId: v.id("sendAttempts"),
    reason: v.string(),
  }),
  v.object({
    outcome: v.literal("preflight_refused"),
    code: v.string(),
    reason: v.string(),
    nextPermittedAt: v.optional(v.number()),
    sendAttemptId: v.optional(v.id("sendAttempts")),
  }),
  v.object({
    outcome: v.literal("already_resolved"),
    sendAttemptId: v.id("sendAttempts"),
    state: v.string(),
  }),
  v.object({
    // A provider request for this draft is live — distinct from
    // `already_resolved` so a journaled caller never records "resolved"
    // for mail still in flight.
    outcome: v.literal("in_flight"),
    sendAttemptId: v.id("sendAttempts"),
    state: v.string(),
  }),
);

export type DispatchOutcome = Infer<typeof vDispatchOutcome>;

/**
 * Shared per-attempt executor: commit point → ONE provider request → record.
 * Called by `sendApprovedDraft` (fresh intent) and by `dispatchAttempt`
 * (the durable reschedule target for window/limit waits and reconciliation).
 */
async function executeAttemptDispatch(
  ctx: ActionCtx,
  sendAttemptId: Id<"sendAttempts">,
): Promise<DispatchOutcome> {
  const begin = await ctx.runMutation(internal.outreach.sendDispatch.beginDispatch, {
    sendAttemptId,
  });
  if (begin.action === "wait") {
    // `beginDispatch` already parked the attempt with a recorded
    // `nextPermittedAt` AND scheduled the re-drive transactionally — this
    // action must not schedule again. Reported to callers (incl. the
    // workflow boundary) as `preflight_refused`/`outside_send_window` so a
    // journaled caller may also sleep durably on the same instant.
    return {
      outcome: "preflight_refused",
      sendAttemptId,
      code: "outside_send_window",
      nextPermittedAt: begin.nextPermittedAt,
      reason: begin.reason,
    };
  }
  if (begin.action === "blocked") {
    return {
      outcome: "preflight_refused",
      sendAttemptId,
      code: begin.code,
      reason: begin.reason,
    };
  }
  if (begin.action === "done") {
    return {
      outcome: "already_resolved",
      sendAttemptId,
      state: "acknowledged",
    };
  }

  // The lost-acknowledgement sweep was scheduled inside `beginDispatch`'s
  // commit transaction — a `requesting` row always has its recovery path.

  // Exactly one provider request. The adapter never retries; it classifies
  // transport results itself, so a returned value is already an honest
  // outcome. A THROWN error is different: `runAction` can fail because the
  // callee isolate was killed or the invocation transport broke — possibly
  // AFTER the provider request was issued. That is provably unknowable, so
  // it lands `uncertain` (the reconcile path treats its identical catch the
  // same way): a false-uncertain costs a human review, a false-rejected can
  // double-send.
  let result:
    | {
        outcome: "accepted";
        messageId: string;
        threadId: string;
        httpStatus?: number;
      }
    | { outcome: "rejected"; httpStatus?: number; providerError: string }
    | {
        outcome: "uncertain";
        providerError: string;
        httpStatus?: number;
        reason?: string;
      };
  try {
    if (begin.endpointOperation === "reply") {
      const call = await ctx.runAction(
        internal.integrations.agentmail.executeReplyAttempt,
        {
          inboxId: begin.inboxRef,
          idempotencyKey: begin.providerIdempotencyKey,
          parentMessageId: begin.parentMessageId ?? "",
          payload: begin.payload,
        },
      );
      result = transportToOutcome(call);
    } else {
      const call = await ctx.runAction(
        internal.integrations.agentmail.executeSendAttempt,
        {
          inboxId: begin.inboxRef,
          idempotencyKey: begin.providerIdempotencyKey,
          payload: begin.payload,
        },
      );
      result = transportToOutcome(call);
    }
  } catch (error) {
    result = {
      outcome: "uncertain",
      reason: "dispatch_error",
      providerError: `dispatch invocation failed (outcome unknown): ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        500,
      ),
    };
  }

  const recorded = await ctx.runMutation(internal.outreach.sendOutcome.recordSendOutcome, {
    sendAttemptId,
    result,
  });
  if (result.outcome === "uncertain") {
    return {
      outcome: "uncertain",
      sendAttemptId,
      reason: result.providerError,
    };
  }
  if (result.outcome === "rejected") {
    // Provider refusal OR a provably pre-request failure — both land as
    // `definitively_failed`; sendResultCode still distinguishes them for UI.
    return {
      outcome: "definitively_failed",
      sendAttemptId,
      reason: result.providerError,
    };
  }
  return {
    outcome: "acknowledged",
    sendAttemptId,
    providerMessageRef: recorded.attempt.providerMessageRef ?? "",
    providerThreadRef: recorded.attempt.providerThreadRef ?? "",
  };
}

/** The domain-error code carried by a thrown ConvexError, if any. */
function thrownCode(error: unknown): string | undefined {
  if (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null
  ) {
    const code = (error.data as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function transportToOutcome(call: {
  outcome: "accepted" | "rejected" | "uncertain";
  messageId?: string;
  threadId?: string;
  httpStatus?: number;
  providerError?: string;
  reason?: string;
  detail?: string;
}):
  | { outcome: "accepted"; messageId: string; threadId: string; httpStatus?: number }
  | { outcome: "rejected"; httpStatus?: number; providerError: string }
  | { outcome: "uncertain"; providerError: string; httpStatus?: number; reason?: string } {
  if (call.outcome === "accepted") {
    return {
      outcome: "accepted",
      messageId: call.messageId ?? "",
      threadId: call.threadId ?? "",
      httpStatus: call.httpStatus,
    };
  }
  if (call.outcome === "rejected") {
    return {
      outcome: "rejected",
      httpStatus: call.httpStatus,
      providerError: call.providerError ?? "provider rejected the request",
    };
  }
  return {
    outcome: "uncertain",
    providerError: call.detail ?? call.providerError ?? "outcome unknown",
    httpStatus: call.httpStatus,
    reason: call.reason,
  };
}

/**
 * Entry point for dispatching an approved draft: reserves the intent, parks
 * on the send window/limit when necessary, or executes immediately. Called
 * from `approvals.approve` and the public `requestDispatch` trigger.
 * Idempotent on the draft's operation key.
 */
export const sendApprovedDraft = internalAction({
  args: {
    draftId: v.id("drafts"),
  },
  returns: vDispatchOutcome,
  handler: async (ctx, args): Promise<DispatchOutcome> => {
    let gate;
    try {
      gate = await ctx.runMutation(internal.outreach.sendReserve.reserveSendIntent, args);
    } catch (error) {
      // Retry once only on optimistic-concurrency conflicts — a capacity
      // race is transient. A deterministic domain error (NOT_FOUND, INVALID)
      // would fail identically and must surface with its real code, never
      // relabelled as a transient attempt conflict.
      if (thrownCode(error) !== "CONFLICT") {
        throw error;
      }
      try {
        gate = await ctx.runMutation(
          internal.outreach.sendReserve.reserveSendIntent,
          args,
        );
      } catch (retryError) {
        return {
          outcome: "preflight_refused" as const,
          code: "unresolved_attempt",
          reason:
            retryError instanceof Error
              ? retryError.message.slice(0, 400)
              : "reserve failed",
        };
      }
    }
    if (gate.action === "blocked") {
      return {
        outcome: "preflight_refused",
        code: gate.code,
        reason: gate.reason,
      };
    }
    if (gate.action === "wait") {
      // `reserveSendIntent` parked the attempt and scheduled the re-drive
      // transactionally — nothing more to schedule here.
      return {
        outcome: "preflight_refused",
        sendAttemptId: gate.sendAttemptId,
        code: "outside_send_window",
        nextPermittedAt: gate.nextPermittedAt,
        reason: gate.reason,
      };
    }
    if (gate.action === "existing") {
      // `existing` only ever reports `reserved` or `requesting` (uncertain
      // is blocked earlier with `attempt_uncertain`). A live provider
      // request is NOT resolved — report it honestly as in-flight.
      if (gate.state === "reserved") {
        return await executeAttemptDispatch(ctx, gate.sendAttemptId);
      }
      return {
        outcome: "in_flight",
        sendAttemptId: gate.sendAttemptId,
        state: gate.state,
      };
    }
    return await executeAttemptDispatch(ctx, gate.sendAttemptId);
  },
});

/**
 * Durable re-entry for a parked/scheduled attempt — the reschedule target
 * for send-window waits. Re-runs every gate via `beginDispatch`; if the
 * window is still closed it reschedules itself, so a workspace restart never
 * loses the wait.
 */
export const dispatchAttempt = internalAction({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vDispatchOutcome,
  handler: async (ctx, args): Promise<Infer<typeof vDispatchOutcome>> =>
    await executeAttemptDispatch(ctx, args.sendAttemptId),
});
