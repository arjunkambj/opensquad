/**
 * `recordSendOutcome` — §8 steps 7/9: the single place a dispatched attempt
 * settles.
 *
 * Acknowledged means the provider accepted the message — never "delivered".
 * It folds in any receipt that arrived before the provider ref was known and
 * links the conversation thread, so a reply can be matched back.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { boundedString, domainError } from "../lib/validators";
import { vSendAttemptDoc } from "./sendAttempts";
import { applyReceiptToAttempt } from "./sendReceipts";
import { v } from "convex/values";
import type { Infer } from "convex/values";

const vOutcomeArg = v.union(
  v.object({
    outcome: v.literal("accepted"),
    messageId: v.string(),
    threadId: v.string(),
    httpStatus: v.optional(v.number()),
  }),
  v.object({
    outcome: v.literal("rejected"),
    httpStatus: v.optional(v.number()),
    providerError: v.string(),
  }),
  v.object({
    outcome: v.literal("uncertain"),
    providerError: v.string(),
    httpStatus: v.optional(v.number()),
    reason: v.optional(v.string()),
  }),
);

const vRecordResult = v.object({
  attempt: vSendAttemptDoc,
  /** true when the call replayed an already-recorded outcome. */
  replayed: v.boolean(),
});

/** How an acknowledged thread ref relates to the attempt's conversation. */
type ThreadMapping =
  | { kind: "claim" }
  | { kind: "already_linked" }
  | { kind: "conflict"; detail: string };

/**
 * Surface an acknowledged send whose conversation could not be mapped. The
 * send stands; only the reply route is missing, so this is the operator's one
 * signal that inbound mail on that thread will need manual assignment.
 */
async function reportThreadLinkMissed(
  ctx: MutationCtx,
  args: {
    attempt: Doc<"sendAttempts">;
    threadId: string;
    detail: string;
  },
): Promise<void> {
  await recordActivityEvent(ctx, {
    workspaceId: args.attempt.workspaceId,
    kind: "conversation_thread_link_missed",
    summary: `Send acknowledged on thread ${args.threadId.slice(0, 120)} but the conversation thread mapping was not written — ${args.detail}; replies on that thread need manual assignment`,
    actor: "workflow",
    dedupeKey: `sendattempt:${args.attempt._id}:threadlinkmiss`,
    conversationId: args.attempt.conversationId,
  });
}

/**
 * Mirror an acknowledged send's provider thread ref onto its conversation.
 *
 * `conversations.(inboxRef, providerThreadRef)` is the pair P11 matches every
 * inbound reply on (§4.3), so a conversation that never records it routes
 * every authentic reply to the unassigned takeover queue — exactly what V15
 * forbids. Called from inside `recordSendOutcome`'s transaction, so a mapping
 * this can write is committed with the accepted outcome and never after it.
 *
 * Never throws, and therefore does NOT guarantee every acknowledged send is
 * mapped: the provider has already accepted the send, so no mapping anomaly
 * may roll the accepted outcome back. Every unmapped case instead emits a
 * `conversation_thread_link_missed` activity event. P11 must still treat an
 * unmatched inbound message as unassigned rather than assuming a mapping
 * exists for OpenSquad-originated threads.
 */
async function linkConversationThread(
  ctx: MutationCtx,
  args: {
    attempt: Doc<"sendAttempts">;
    threadId: string;
    at: number;
  },
): Promise<void> {
  const { attempt, threadId, at } = args;
  const conversation = await ctx.db.get(
    "conversations",
    attempt.conversationId,
  );
  // Workspace boundary — an attempt never writes through into another
  // workspace's conversation row. This is the one branch here that indicates a
  // real integrity violation, so it is reported rather than returned silently.
  if (
    conversation === null ||
    conversation.workspaceId !== attempt.workspaceId
  ) {
    await reportThreadLinkMissed(ctx, {
      attempt,
      threadId,
      detail:
        conversation === null
          ? "the attempt's conversation row is missing"
          : "the attempt's conversation belongs to another workspace",
    });
    return;
  }

  let mapping: ThreadMapping;
  if (conversation.inboxRef !== attempt.inboxRef) {
    // The stored pair keys on the conversation's own `inboxRef`, but the mail
    // left on the attempt's. Equal on every path today; if they ever diverge,
    // claiming would write an index entry P11's inbound matcher never reads.
    mapping = {
      kind: "conflict",
      detail: `conversation is bound to a different inbox than the send`,
    };
  } else if (conversation.providerThreadRef === threadId) {
    mapping = { kind: "already_linked" };
  } else if (conversation.providerThreadRef !== undefined) {
    // A thread ref is stable for the life of a thread. Overwriting it would
    // orphan every reply already threaded under the first ref, so the first
    // one stands and the second is surfaced. This is not only a provider
    // anomaly: a follow-up with no inbound reply dispatches as `send` rather
    // than `reply` (`endpointFor` in draftsModel.ts), and AgentMail mints a fresh
    // thread for a send — so the second thread stays unmapped by design and
    // its replies need assignment.
    mapping = {
      kind: "conflict",
      detail: `already mapped to thread ${conversation.providerThreadRef.slice(0, 120)}`,
    };
  } else {
    // §4.3 uniqueness on (inboxRef, providerThreadRef) — the same guard
    // `conversationStaging.stageConversation` applies before it patches or inserts a
    // thread ref, except it may not throw here. `.collect()`, not `.unique()`:
    // an already-violated pair must not strand an acknowledged send, and the
    // index is not workspace-scoped, so a foreign row must neither block the
    // claim nor have its id quoted into this workspace's activity feed.
    const holders = await ctx.db
      .query("conversations")
      .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
        q
          .eq("inboxRef", conversation.inboxRef)
          .eq("providerThreadRef", threadId),
      )
      .collect();
    const duplicate = holders.find(
      (row) =>
        row._id !== conversation._id &&
        row.workspaceId === conversation.workspaceId,
    );
    mapping =
      duplicate !== undefined
        ? {
            kind: "conflict",
            detail: `thread already mapped to conversation ${duplicate._id}`,
          }
        : { kind: "claim" };
  }

  if (mapping.kind === "conflict") {
    await reportThreadLinkMissed(ctx, {
      attempt,
      threadId,
      detail: mapping.detail,
    });
  }

  // Recency is monotonic: P11's inbound processing writes `lastMessageAt`
  // too, and a reconcile can record this acknowledgement long after a newer
  // reply landed — a late outbound ack must never rewind the inbox ordering.
  const advanceRecency =
    conversation.lastMessageAt === undefined || conversation.lastMessageAt < at;
  const claims = mapping.kind === "claim";
  if (!claims && !advanceRecency) {
    return; // replay of an already-linked, already-current conversation
  }
  await ctx.db.patch("conversations", conversation._id, {
    ...(claims ? { providerThreadRef: threadId } : {}),
    ...(advanceRecency ? { lastMessageAt: at } : {}),
    updatedAt: at,
  });
}

/**
 * Persist the provider outcome onto the attempt — the ONLY write path from
 * transport result to durable state.
 *
 * - `accepted` stores the provider message/thread refs, commits the usage
 *   reservation, and folds in any delivery receipts that arrived BEFORE the
 *   acknowledgement stored the message ref (G3 — delivery events can win
 *   that race; they are verified provider facts, not transport truth).
 * - `rejected` marks `definitively_failed` and releases the reservation.
 * - `uncertain` keeps the attempt unresolved, retains capacity as
 *   `uncertain`, and opens the `delivery_uncertain` ask in the same
 *   transaction — an uncertain attempt can never exist without its ask —
 *   no retry, no new key.
 * - `reconcile: true` marks this as the reconciliation path outcome and is
 *   the only way an `uncertain` attempt may transition; a confirmed verdict
 *   also retires the open delivery-uncertainty ask.
 */
export const recordSendOutcome = internalMutation({
  args: {
    sendAttemptId: v.id("sendAttempts"),
    result: vOutcomeArg,
    reconcile: v.optional(v.boolean()),
  },
  returns: vRecordResult,
  handler: async (ctx, args): Promise<Infer<typeof vRecordResult>> => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    const now = Date.now();

    // Replays: an already-acknowledged attempt accepts the identical
    // provider refs and nothing else.
    if (attempt.state === "acknowledged") {
      if (
        args.result.outcome === "accepted" &&
        args.result.messageId === attempt.providerMessageRef
      ) {
        return { attempt, replayed: true };
      }
      throw domainError(
        "CONFLICT",
        `attempt is already acknowledged as ${attempt.providerMessageRef}`,
      );
    }
    if (attempt.state !== "requesting" && attempt.state !== "uncertain") {
      throw domainError(
        "CONFLICT",
        `attempt is ${attempt.state}; a provider outcome cannot land on it`,
      );
    }

    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft === null) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    const settle = async (
      target: "committed" | "released" | "uncertain",
      providerReference?: string,
    ) => {
      const reservation = await ctx.runMutation(
        internal.billing.reservations.getByOperationKey,
        {
          workspaceId: attempt.workspaceId,
          operationKey: attempt.operationKey,
        },
      );
      if (reservation === null) {
        return; // parked attempts never took a reservation
      }
      const fn =
        target === "committed"
          ? internal.billing.reservations.commit
          : target === "released"
            ? internal.billing.reservations.release
            : internal.billing.reservations.markUncertain;
      await ctx.runMutation(fn, {
        workspaceId: attempt.workspaceId,
        operationKey: attempt.operationKey,
        ...(providerReference !== undefined ? { providerReference } : {}),
      });
    };

    if (args.result.outcome === "accepted") {
      const messageId = boundedString(args.result.messageId, "messageId", {
        min: 1,
        max: 400,
      });
      const threadId = boundedString(args.result.threadId, "threadId", {
        min: 1,
        max: 400,
      });
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "acknowledged",
        providerMessageRef: messageId,
        providerThreadRef: threadId,
        ...(args.reconcile === true || attempt.state === "uncertain"
          ? { reconciledAt: now }
          : {}),
        updatedAt: now,
      });
      // Same transaction as the accepted outcome: an acknowledged send whose
      // conversation carries no thread ref loses every reply to it.
      await linkConversationThread(ctx, {
        attempt,
        threadId,
        at: now,
      });
      // Same transaction again (§8 step 5, P19): the provider's acceptance is
      // the ONLY fact that may stamp `lastContactedAt` and advance the lead —
      // `contacted` for a plain send, `booking_proposed` when this exact
      // draft carries a live booking link. Non-throwing by contract: a broken
      // association records less, never rolls back the acceptance.
      await ctx.runMutation(internal.leads.mutations.markSendAccepted, {
        sendAttemptId: attempt._id,
        at: now,
      });
      await settle("committed", messageId);
      // Fold any delivery receipts that beat the acknowledgement.
      const early = await ctx.db
        .query("emailEventReceipts")
        .withIndex("by_providerMessageRef", (q) =>
          q.eq("providerMessageRef", messageId),
        )
        .collect();
      for (const receipt of early) {
        if (receipt.handlingState === "pending") {
          await applyReceiptToAttempt(ctx, receipt, attempt._id);
        }
      }
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        kind:
          attempt.state === "uncertain"
            ? "send_attempt_reconciled"
            : "send_attempt_acknowledged",
        summary: `Provider accepted send (message ${messageId})`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:acknowledged`,
        conversationId: attempt.conversationId,
      });
    } else if (args.result.outcome === "rejected") {
      // Provider error text is unbounded input — truncate, never refuse to
      // record the outcome (a throw here strands the attempt in `requesting`).
      const providerError = args.result.providerError.slice(0, 500);
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "definitively_failed",
        error: {
          message: providerError,
          at: now,
          ...(args.result.httpStatus !== undefined
            ? { httpStatus: args.result.httpStatus }
            : {}),
          reason: "provider_rejected",
        },
        ...(args.reconcile === true || attempt.state === "uncertain"
          ? { reconciledAt: now }
          : {}),
        updatedAt: now,
      });
      await settle("released");
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        kind:
          attempt.state === "uncertain"
            ? "send_attempt_reconciled"
            : "send_attempt_failed",
        summary: `Provider rejected send: ${providerError.slice(0, 200)}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:failed`,
        conversationId: attempt.conversationId,
      });
    } else {
      const providerError = args.result.providerError.slice(0, 500);
      await ctx.db.patch("sendAttempts", attempt._id, {
        state: "uncertain",
        error: {
          message: providerError,
          at: now,
          ...(args.result.httpStatus !== undefined
            ? { httpStatus: args.result.httpStatus }
            : {}),
          reason: args.result.reason ?? "unknown",
        },
        updatedAt: now,
      });
      await settle("uncertain");
      await recordActivityEvent(ctx, {
        workspaceId: attempt.workspaceId,
        kind: "send_attempt_uncertain",
        summary: `Send outcome is uncertain — ${providerError.slice(0, 200)}`,
        actor: "workflow",
        dedupeKey: `sendattempt:${attempt._id}:uncertain`,
        conversationId: attempt.conversationId,
      });
    }

    const updated = await ctx.db.get("sendAttempts", attempt._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "send attempt not found after update");
    }
    return { attempt: updated, replayed: false };
  },
});
