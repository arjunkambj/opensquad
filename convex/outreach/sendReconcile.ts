/**
 * Reconciliation — §8.7.
 *
 * An `uncertain` attempt is replayed only through the SAME provider
 * idempotency key, only inside the provider's key-retention window and only
 * while policy still permits dispatch. Otherwise the attempt stays
 * `uncertain` and blocks the thread until a human resolves it.
 */
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import {
  domainError,
  sendWindowStatus,
  vSendAttemptState,
} from "../lib/validators";
import { transportToOutcome, vDispatchOutcome } from "./sendActions";
import type { DispatchOutcome } from "./sendActions";
import { vSendPayload } from "./sendDispatch";
import { evaluateSendGates } from "./sendGates";
import { loadAttemptContext, RECONCILE_WINDOW_MS } from "./sendModel";
import { v } from "convex/values";
import type { Infer } from "convex/values";

const vPrepareResult = v.union(
  v.object({
    action: v.literal("replay"),
    sendAttemptId: v.id("sendAttempts"),
    /** Whose key the replay is made with — there is no platform key. */
    orgId: v.id("orgs"),
    inboxRef: v.string(),
    providerIdempotencyKey: v.string(),
    endpointOperation: v.union(v.literal("send"), v.literal("reply")),
    parentMessageId: v.optional(v.string()),
    payload: vSendPayload,
  }),
  v.object({
    action: v.literal("wait"),
    nextPermittedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("needs_review"),
    reason: v.string(),
  }),
  v.object({
    action: v.literal("resolved"),
    state: vSendAttemptState,
  }),
  v.object({
    // A provider request is still live — distinct from `resolved` so a
    // journaled caller never records "resolved" for mail in flight.
    action: v.literal("in_flight"),
    state: vSendAttemptState,
  }),
);

/**
 * Guarded recheck before an uncertain attempt may be replayed (G3 step 8):
 * the SAME idempotency key + SAME payload, only inside the provider's key
 * retention window, and only while org policy still permits dispatch
 * (not paused, no takeover, no suppression, context unchanged, inside the
 * send window). Anything else routes to human review — the recorded
 * attempt stays `uncertain`.
 */
export const prepareReconcile = internalMutation({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vPrepareResult,
  handler: async (ctx, args): Promise<Infer<typeof vPrepareResult>> => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    if (attempt.state !== "uncertain") {
      if (attempt.state === "reserved" || attempt.state === "requesting") {
        return { action: "in_flight" as const, state: attempt.state };
      }
      return { action: "resolved" as const, state: attempt.state };
    }
    const started = attempt.requestStartedAt ?? attempt.createdAt;
    if (started + RECONCILE_WINDOW_MS < Date.now()) {
      return {
        action: "needs_review" as const,
        reason:
          "provider idempotency window has expired — replay can no longer prove the original outcome; human review required",
      };
    }
    const context = await loadAttemptContext(ctx, attempt.draftId);
    const { org, conversation, draft, agent } = context;
    const gate = await evaluateSendGates(ctx, {
      org,
      conversation,
      draft,
      agent,
      excludeAttemptId: attempt._id,
    });
    if (!gate.ok) {
      return {
        action: "needs_review" as const,
        reason: `policy no longer permits dispatch (${gate.code}: ${gate.reason})`,
      };
    }
    const window = sendWindowStatus(org, Date.now());
    if (!window.permitted) {
      // Transactional re-drive — a reconcile wait can never be lost between
      // this return and a caller-side schedule.
      await ctx.scheduler.runAfter(
        Math.max(0, window.nextPermittedAt - Date.now()),
        internal.outreach.sendReconcile.reconcileUncertainAttempt,
        { sendAttemptId: attempt._id },
      );
      return {
        action: "wait" as const,
        nextPermittedAt: window.nextPermittedAt,
        reason: "outside_window",
      };
    }
    return {
      action: "replay" as const,
      sendAttemptId: attempt._id,
      orgId: org._id,
      inboxRef: draft.inboxRef,
      providerIdempotencyKey: attempt.providerIdempotencyKey,
      endpointOperation: attempt.endpointOperation,
      parentMessageId: draft.replyToMessageRef,
      payload: {
        to: draft.normalizedRecipient,
        ...(draft.subject.length > 0 ? { subject: draft.subject } : {}),
        text: draft.body,
      },
    };
  },
});

/**
 * The reconciliation action: guarded recheck → ONE replay with the SAME
 * provider idempotency key → record the verdict. Never mints a fresh key;
 * an expired window or a policy block returns needs_review and leaves the
 * attempt (and its ask) for a human.
 */
export const reconcileUncertainAttempt = internalAction({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vDispatchOutcome,
  handler: async (ctx, args): Promise<DispatchOutcome> => {
    const prepared = await ctx.runMutation(internal.outreach.sendReconcile.prepareReconcile, {
      sendAttemptId: args.sendAttemptId,
    });
    if (prepared.action === "resolved") {
      return {
        outcome: "already_resolved",
        sendAttemptId: args.sendAttemptId,
        state: prepared.state,
      };
    }
    if (prepared.action === "in_flight") {
      return {
        outcome: "in_flight",
        sendAttemptId: args.sendAttemptId,
        state: prepared.state,
      };
    }
    if (prepared.action === "needs_review") {
      return {
        outcome: "uncertain",
        sendAttemptId: args.sendAttemptId,
        reason: `needs human review: ${prepared.reason}`,
      };
    }
    if (prepared.action === "wait") {
      // `prepareReconcile` already scheduled the re-drive transactionally.
      return {
        outcome: "preflight_refused",
        sendAttemptId: args.sendAttemptId,
        code: "outside_send_window",
        nextPermittedAt: prepared.nextPermittedAt,
        reason: prepared.reason,
      };
    }

    let result;
    try {
      if (prepared.endpointOperation === "reply") {
        const call = await ctx.runAction(
          internal.integrations.agentmail.reconcileReplyAttempt,
          {
            orgId: prepared.orgId,
            inboxId: prepared.inboxRef,
            idempotencyKey: prepared.providerIdempotencyKey,
            parentMessageId: prepared.parentMessageId ?? "",
            payload: prepared.payload,
          },
        );
        result = transportToOutcome(call);
      } else {
        const call = await ctx.runAction(
          internal.integrations.agentmail.reconcileSendAttempt,
          {
            orgId: prepared.orgId,
            inboxId: prepared.inboxRef,
            idempotencyKey: prepared.providerIdempotencyKey,
            payload: prepared.payload,
          },
        );
        result = transportToOutcome(call);
      }
    } catch (error) {
      // A pre-request failure proves nothing about the original request —
      // the attempt stays uncertain.
      return {
        outcome: "uncertain",
        sendAttemptId: args.sendAttemptId,
        reason: `reconcile request could not be issued: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          400,
        ),
      };
    }
    const recorded = await ctx.runMutation(
      internal.outreach.sendOutcome.recordSendOutcome,
      {
        sendAttemptId: args.sendAttemptId,
        result,
        reconcile: true,
      },
    );
    if (result.outcome === "uncertain") {
      return {
        outcome: "uncertain",
        sendAttemptId: args.sendAttemptId,
        reason: result.providerError,
      };
    }
    if (result.outcome === "accepted") {
      return {
        outcome: "acknowledged",
        sendAttemptId: args.sendAttemptId,
        providerMessageRef: recorded.attempt.providerMessageRef ?? "",
        providerThreadRef: recorded.attempt.providerThreadRef ?? "",
      };
    }
    return {
      outcome: "definitively_failed",
      sendAttemptId: args.sendAttemptId,
      reason: result.providerError,
    };
  },
});

/**
 * Read-only evidence bundle for an attempt (G3 step 8): the provider-side
 * message/thread existence check plus every recorded receipt — the input a
 * human (or a probe) needs to resolve a `delivery_uncertain` ask honestly.
 * Performs no writes and issues no provider mutations.
 */
const vEvidenceResult = v.object({
  sendAttemptId: v.id("sendAttempts"),
  state: vSendAttemptState,
  providerMessageRef: v.optional(v.string()),
  providerThreadRef: v.optional(v.string()),
  provider: v.object({
    message: v.union(
      v.object({ messageId: v.string(), threadId: v.string() }),
      v.null(),
    ),
    thread: v.union(
      v.object({
        threadId: v.string(),
        messageCount: v.optional(v.number()),
      }),
      v.null(),
    ),
    error: v.optional(v.string()),
  }),
  receipts: v.array(
    v.object({
      providerEventId: v.string(),
      eventType: v.string(),
      handlingState: v.string(),
      receivedAt: v.number(),
      handledAt: v.optional(v.number()),
    }),
  ),
  deliveryFacts: v.optional(v.record(v.string(), v.any())),
  withinReconcileWindow: v.boolean(),
});

export const gatherProviderEvidence = internalAction({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: vEvidenceResult,
  handler: async (ctx, args): Promise<Infer<typeof vEvidenceResult>> => {
    const attempt = await ctx.runQuery(internal.outreach.sendAttempts.getInternal, {
      sendAttemptId: args.sendAttemptId,
    });
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    const receipts = await ctx.runQuery(
      internal.outreach.sendAttempts.receiptsForAttempt,
      { sendAttemptId: args.sendAttemptId },
    );
    const provider = await ctx.runAction(
      internal.integrations.agentmail.lookupProviderMessage,
      {
        orgId: attempt.orgId,
        inboxId: attempt.inboxRef,
        ...(attempt.providerMessageRef !== undefined
          ? { messageId: attempt.providerMessageRef }
          : {}),
        ...(attempt.providerThreadRef !== undefined
          ? { threadId: attempt.providerThreadRef }
          : {}),
      },
    );
    const started = attempt.requestStartedAt ?? attempt.createdAt;
    return {
      sendAttemptId: attempt._id,
      state: attempt.state,
      ...(attempt.providerMessageRef !== undefined
        ? { providerMessageRef: attempt.providerMessageRef }
        : {}),
      ...(attempt.providerThreadRef !== undefined
        ? { providerThreadRef: attempt.providerThreadRef }
        : {}),
      provider,
      receipts: receipts.map((receipt) => ({
        providerEventId: receipt.providerEventId,
        eventType: receipt.eventType,
        handlingState: receipt.handlingState,
        receivedAt: receipt.receivedAt,
        ...(receipt.handledAt !== undefined
          ? { handledAt: receipt.handledAt }
          : {}),
      })),
      ...(attempt.providerDeliveryFacts !== undefined
        ? { deliveryFacts: attempt.providerDeliveryFacts }
        : {}),
      withinReconcileWindow:
        started + RECONCILE_WINDOW_MS >= Date.now(),
    };
  },
});
