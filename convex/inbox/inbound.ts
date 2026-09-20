/**
 * Inbox — verified provider mail becomes conversation state (P11,
 * architecture §8 "Incoming message processing", integrations.md §G3).
 *
 * This domain owns everything after a provider event has been verified:
 * deduping the application effect, matching the message to a conversation,
 * applying it in a provable order, the conversation surface the inbox screens
 * read, and the quarantine for mail we cannot attribute. It owns neither the
 * webhook (integrations/) nor the outgoing message (outreach/).
 *
 * TWO DEDUPES, TWO DIFFERENT PROBLEMS. The component's `event_id` ledger
 * stops one DELIVERY being ingested twice. It does nothing about the same
 * logical MESSAGE arriving under a second event id — that is
 * `emailEventReceipts.applicationKey`, `incoming:<inboxRef>:<messageRef>`,
 * enforced inside `recordReceipt` before this module is ever scheduled.
 *
 * THE RECEIPT IS THE UNIT OF WORK. The callback records it and schedules this
 * module; the schedule commits with the row. Handling runs in its own
 * transaction so a throw in the business path cannot roll back the receipt
 * that makes the event replayable — it leaves the row `pending` and the
 * `inbound-receipt-drain` cron re-drives it.
 *
 * THE ORDER, which is the whole point and what V16–V18 test:
 *
 *   1. `conversationStaging.applyInboundContext` — advance `contextVersion`,
 *      supersede every open draft approval, cancel every parked follow-up;
 *   2. the inbound facts the conversation row owns;
 *   3. the deterministic opt-out rule — suppress a verified explicit request,
 *      freeze automation for an unclear one, guess at neither;
 *   4. the reply-automation gate, read after all of the above;
 *   5. ONLY THEN may reply work start.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { applyToConversation } from "./inboundApply";
import {
  fail,
  matchConversation,
  readInboundFacts,
  settleReceipt,
} from "./inboundModel";
import { vReplyGateVerdict } from "./replyGate";
import type { ReplyGateBlockCode } from "./replyGate";
import { v } from "convex/values";

/**
 * What one inbound receipt did. Returned rather than thrown: the drain and
 * the probe both need to read the verdict, and a throw would roll back the
 * receipt transition that records it.
 */
export const vInboundOutcome = v.union(
  /** Matched an existing conversation; its context advanced. */
  v.literal("applied"),
  /** Matched nothing; a new unassigned conversation now holds it. */
  v.literal("queued"),
  /** Nothing to do — not pending, not inbound, or the row is gone. */
  v.literal("skipped"),
  /** Recorded on the receipt as `failed`; it will not be retried blindly. */
  v.literal("failed"),
);

export type InboundOutcome = typeof vInboundOutcome.type;

export const vApplyInboundMessageResult = v.object({
  outcome: vInboundOutcome,
  conversationId: v.optional(v.id("conversations")),
  /** The conversation version AFTER this message was applied. */
  contextVersion: v.optional(v.number()),
  /** Whether reply automation was allowed to run, and if not, why not. */
  replyWork: v.optional(vReplyGateVerdict),
  reason: v.optional(v.string()),
});

/**
 * Annotated explicitly, and every handler below that produces one says so.
 * A Convex handler's return type is otherwise inferred, and these handlers
 * reach other modules through the generated `internal` object — which is typed
 * from this module too, so the inference would be circular (TS7022/TS7023).
 * The same reason `drafts.retireConversationWork` returns `v.null()`.
 */
export type ApplyInboundMessageResult = typeof vApplyInboundMessageResult.type;

/**
 * Blockers worth a note on the thread.
 *
 * The rest are already visible without one: an unassigned thread carries its
 * intake note and its takeover reason, a hold wrote its own note as it was
 * placed, and a closed thread is closed. Writing a note for those on every
 * inbound message would bury the ones that say something new under repetition.
 */
export const NOTED_REPLY_GATE_BLOCKS: ReadonlySet<ReplyGateBlockCode> = new Set<
  ReplyGateBlockCode
>([
  "association_missing",
  "agent_mismatch",
  "agent_not_sending",
  "workspace_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "suppressed_email",
  "suppressed_domain",
]);

/**
 * Handle one pending inbound receipt. Scheduled by the AgentMail callback at
 * commit time, and re-driven by `inbound-receipt-drain` if that schedule was
 * lost or the first attempt threw.
 *
 * Idempotent by construction: it refuses a receipt that is not `pending`, and
 * `recordReceipt` already refused to create a second pending row for a message
 * this workspace has seen.
 *
 * And ORDER-SAFE by construction: a receipt older than the inbound the
 * conversation already carries is settled without being applied, so the drain
 * — the one path that can deliver an older message after a newer one — can
 * never rewind the thread.
 */
export const applyInboundMessage = internalMutation({
  args: { receiptId: v.id("emailEventReceipts") },
  returns: vApplyInboundMessageResult,
  handler: async (ctx, args): Promise<ApplyInboundMessageResult> => {
    const receipt = await ctx.db.get("emailEventReceipts", args.receiptId);
    if (receipt === null) {
      return { outcome: "skipped" as const, reason: "receipt not found" };
    }
    if (receipt.eventType !== "message.received") {
      return {
        outcome: "skipped" as const,
        reason: "receipt is not an inbound message",
      };
    }
    if (receipt.handlingState !== "pending") {
      // Already applied, or recorded as a duplicate application key. Either
      // way the business effect has happened at most once.
      return { outcome: "skipped" as const, reason: "receipt is not pending" };
    }

    const facts = readInboundFacts(receipt);
    const { conversation, ambiguous } = await matchConversation(ctx, receipt);

    let target = conversation;
    let queued = false;
    if (target === null) {
      // Verified mail on a KNOWN inbox that matches no thread. It is not
      // dropped and it is not guessed at: it enters this workspace's
      // unassigned queue under human takeover, with no lead, no draft and no
      // send (architecture §8 step 4).
      const threadRef = receipt.providerThreadRef;
      if (threadRef === undefined) {
        // Nothing to key a conversation on, so a row created here could never
        // be matched again by a later message on the same thread. Recording
        // the refusal beats minting an orphan.
        return await fail(
          ctx,
          receipt,
          "inbound message carries no provider thread reference",
        );
      }
      const ensured = await ctx.runMutation(
        internal.inbox.unassignedQueue.ensureUnassignedConversation,
        {
          workspaceId: receipt.workspaceId,
          inboxRef: receipt.inboxRef,
          providerThreadRef: threadRef,
          messageRef: receipt.providerMessageRef,
          at: receipt.receivedAt,
          ...(facts.fromAddress !== undefined
            ? { fromAddress: facts.fromAddress }
            : {}),
        },
      );
      if (!ensured.ok) {
        // Unrecoverable, so it is recorded rather than thrown: a throw would
        // leave the receipt `pending` and the drain would retry it forever.
        return await fail(ctx, receipt, ensured.reason);
      }
      target = ensured.conversation;
      queued = ensured.created;
    }

    // A LATE inbound must never rewind the conversation.
    //
    // The drain exists precisely so a receipt whose callback schedule was
    // lost is re-driven minutes or hours later — by which time a NEWER
    // message on the same thread may already have been applied. Everything
    // `applyToConversation` writes describes "the latest inbound":
    // `lastInboundMessageRef`, `lastInboundAt`, `lastInboundFrom` and a
    // `contextVersion` bump that invalidates every recorded approval.
    // Replaying an older message through it would rewind all four —
    // invalidating the draft an operator is looking at for the newer message
    // and answering the older one instead.
    //
    // `drafts.applyInboundContext` already clamps `lastMessageAt` for exactly
    // this reason and says so; its own guard compares only the LAST applied
    // message, so it cannot see a late A behind an applied B. This is that
    // same clamp for everything the late message would otherwise carry.
    // Settled `handled`, not `failed`: nothing went wrong — the message is
    // real, it simply arrived after the thread had moved past it, and the
    // reason makes that readable in `sendAttempts.listReceipts`.
    const lastInboundAt = target.lastInboundAt;
    if (lastInboundAt !== undefined && receipt.receivedAt < lastInboundAt) {
      await settleReceipt(ctx, receipt, "handled", "late_inbound_superseded");
      return {
        outcome: "skipped" as const,
        conversationId: target._id,
        contextVersion: target.contextVersion,
        reason: "late_inbound_superseded",
      };
    }

    const applied = await applyToConversation(ctx, receipt, target, facts);

    await settleReceipt(
      ctx,
      receipt,
      "handled",
      ambiguous ? "ambiguous_thread_mapping" : undefined,
    );
    return {
      outcome: queued ? ("queued" as const) : ("applied" as const),
      conversationId: applied.conversation._id,
      contextVersion: applied.conversation.contextVersion,
      replyWork: applied.replyWork,
    };
  },
});
