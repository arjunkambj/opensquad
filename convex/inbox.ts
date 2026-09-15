/**
 * Inbound ingest — verified provider mail becomes conversation state (P11,
 * architecture §8 "Incoming message processing", integrations.md §G3).
 *
 * The webhook itself is not here and must not be rebuilt here. The
 * `@agentmail/convex` component verifies the svix signature over the raw body,
 * dedupes the provider `event_id` and stores the message; `convex/http.ts`
 * mounts it; `convex/integrations/agentmail.ts` receives its callbacks. What
 * this module owns is everything after that: deduping the APPLICATION EFFECT,
 * matching the message to a conversation, and applying it in an order that can
 * be read off the code.
 *
 * TWO DEDUPES, TWO DIFFERENT PROBLEMS.
 *
 * The component's `event_id` ledger stops one DELIVERY being ingested twice.
 * It does nothing about the same logical MESSAGE arriving under a second event
 * id — which is the case that would advance a conversation twice and strand an
 * approval granted in between. That is `emailEventReceipts.applicationKey`,
 * `incoming:<inboxRef>:<messageRef>`, enforced inside `recordReceipt` before
 * this module is ever scheduled (§4.3). `drafts.applyInboundContext` has its
 * own guard, but it compares only against the LAST applied message, so a
 * replay in the order A → B → A would slip past it; the receipt key is the
 * durable per-message gate and the reason nothing here re-checks arrival
 * order by hand.
 *
 * THE RECEIPT IS THE UNIT OF WORK. The callback records it and schedules this
 * module; the schedule commits with the row. Handling runs in its own
 * transaction so a throw in the business path cannot roll back the receipt
 * that makes the event replayable — it leaves the row `pending` and the
 * `inbound-receipt-drain` cron re-drives it. Conditions that will never
 * succeed are written as `failed` with a bounded reason instead of thrown, so
 * they are visible rather than looping.
 *
 * EVERY INBOUND STRING IS DATA. Svix proved the payload came from AgentMail
 * untampered; it proved nothing about the content, which was written by
 * whoever sent the email. `from` is stored as data and can only ever make a
 * later check refuse. `in_reply_to`/`references` are not read at all — they
 * can name any message id, including another tenant's, so they are never the
 * authority for conversation identity and are not used as a hint either.
 * Subjects and bodies never reach an app table from here and are never logged.
 */
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { boundedString } from "./lib/validators";

/* ------------------------------------------------------------------ */
/* Receipt facts                                                       */
/* ------------------------------------------------------------------ */

/**
 * The bounded projection the callback leaves on the receipt for this module
 * to read back.
 *
 * It lives on the receipt rather than in the scheduler argument because the
 * drain re-drives from the row alone — an argument would be lost the moment
 * handling failed once. `providerFacts` holds only facts a business decision
 * needs (§4.3: "only necessary verified facts and never another copy of full
 * message bodies"): no subject, no body, no headers.
 */
type InboundFacts = {
  /** Normalized `From`, when the header named exactly one parseable address. */
  fromAddress?: string;
};

function readInboundFacts(receipt: Doc<"emailEventReceipts">): InboundFacts {
  const fromAddress = receipt.providerFacts.fromAddress;
  return {
    ...(typeof fromAddress === "string" && fromAddress.length > 0
      ? { fromAddress }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Outcome                                                             */
/* ------------------------------------------------------------------ */

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

/** Bound on the `error` string a receipt carries. */
const RECEIPT_ERROR_MAX_LENGTH = 500;

/**
 * Record an unrecoverable condition on the receipt instead of throwing it.
 *
 * A throw would roll back the transaction, leave the row `pending`, and hand
 * the drain something it will retry on every sweep for as long as the row
 * lives. `failed` is terminal, visible in `sendAttempts.listReceipts`, and
 * still replayable by hand.
 */
async function fail(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  reason: string,
): Promise<{ outcome: "failed"; reason: string }> {
  await settleReceipt(ctx, receipt, "failed", reason);
  return { outcome: "failed", reason };
}

async function settleReceipt(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  handlingState: "handled" | "failed",
  error?: string,
): Promise<void> {
  await ctx.db.patch("emailEventReceipts", receipt._id, {
    handlingState,
    handledAt: Date.now(),
    ...(error === undefined
      ? {}
      : {
          error: boundedString(error, "error", {
            min: 1,
            max: RECEIPT_ERROR_MAX_LENGTH,
          }),
        }),
  });
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/**
 * Resolve `(inboxRef, providerThreadRef)` to a conversation in the receipt's
 * OWN workspace.
 *
 * This follows `sending.linkConversationThread`, not `drafts.stageConversation`:
 * the pair's uniqueness is a transactional convention, not a database
 * constraint, and `by_inboxRef_and_providerThreadRef` is not workspace-scoped.
 * `.unique()` would throw on an already-violated pair and wedge the receipt
 * forever, and a row belonging to another workspace must neither block this
 * match nor have its id quoted into this workspace's feed — hence `.collect()`
 * then an explicit workspace filter.
 *
 * More than one in-workspace row is an anomaly, not a crash: the earliest
 * row wins deterministically and the caller records the ambiguity on the
 * receipt.
 */
async function matchConversation(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
): Promise<{
  conversation: Doc<"conversations"> | null;
  ambiguous: boolean;
}> {
  const threadRef = receipt.providerThreadRef;
  if (threadRef === undefined) {
    // No provider thread reference is no match. It is never resolved from
    // RFC 5322 threading headers, which the sender controls.
    return { conversation: null, ambiguous: false };
  }
  const rows = await ctx.db
    .query("conversations")
    .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
      q.eq("inboxRef", receipt.inboxRef).eq("providerThreadRef", threadRef),
    )
    .collect();
  const owned = rows
    .filter((row) => row.workspaceId === receipt.workspaceId)
    .sort((left, right) => left._creationTime - right._creationTime);
  if (owned.length === 0) {
    return { conversation: null, ambiguous: false };
  }
  return { conversation: owned[0], ambiguous: owned.length > 1 };
}

/* ------------------------------------------------------------------ */
/* The ordering rule                                                   */
/* ------------------------------------------------------------------ */

/**
 * Apply one verified inbound message to its conversation, in the order
 * architecture §8 requires and V17 tests.
 *
 * STEP 1 — `internal.drafts.applyInboundContext`, first and unconditionally.
 * One call, three invalidations, and this module reimplements none of them:
 * it advances `contextVersion` (which is what makes every live approval
 * refuse at preflight with `context_changed`), supersedes every open
 * `draft_approval` ask through `internal.decisions.supersedeDecision` (which
 * owns the `requiredDecisionCount` decrement, the `waiting_for_user → active`
 * un-park and the workflow wake-up), and calls
 * `internal.sending.cancelParkedConversationAttempts` (which releases each
 * `reserved` attempt's usage reservation and unwinds its coverage links) —
 * that last one being "cancel pending follow-ups".
 *
 * STEP 2 — the inbound facts P11 owns that step 1 does not touch.
 *
 * Everything runs inside the caller's single transaction; `ctx.runMutation`
 * from a mutation is a sub-transaction of it, so either all of it commits or
 * none of it does. Nothing that could spend a model token exists above this
 * point, and later stages hang their dispatch strictly below it.
 */
async function applyToConversation(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  conversation: Doc<"conversations">,
  facts: InboundFacts,
): Promise<Doc<"conversations">> {
  // 1. Version bump, approval invalidation, parked follow-up cancellation.
  await ctx.runMutation(internal.drafts.applyInboundContext, {
    conversationId: conversation._id,
    lastInboundMessageRef: receipt.providerMessageRef,
    // Ingest time, never the provider's `timestamp`: the component's
    // `parseTimestamp` silently falls back to `Date.now()` on a parse
    // failure, so the provider stamp is not an ordering authority.
    at: receipt.receivedAt,
    markUnread: true,
  });

  // 2. The sender, as data. Written after step 1 so it can never be the
  //    reason a version bump did or did not happen.
  const current = await ctx.db.get("conversations", conversation._id);
  if (current === null) {
    return conversation;
  }
  if (
    facts.fromAddress !== undefined &&
    facts.fromAddress !== current.lastInboundFrom
  ) {
    await ctx.db.patch("conversations", current._id, {
      lastInboundFrom: facts.fromAddress,
      updatedAt: Date.now(),
    });
  }
  const updated = await ctx.db.get("conversations", current._id);
  return updated ?? current;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Handle one pending inbound receipt. Scheduled by the AgentMail callback at
 * commit time, and re-driven by `inbound-receipt-drain` if that schedule was
 * lost or the first attempt threw.
 *
 * Idempotent by construction: it refuses a receipt that is not `pending`, and
 * `recordReceipt` already refused to create a second pending row for a message
 * this workspace has seen.
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
      // unassigned queue under human takeover, with no lead, no mission, no
      // reply workflow, no draft and no send (architecture §8 step 4).
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
        internal.conversations.ensureUnassignedConversation,
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

    const applied = await applyToConversation(ctx, receipt, target, facts);

    await settleReceipt(
      ctx,
      receipt,
      "handled",
      ambiguous ? "ambiguous_thread_mapping" : undefined,
    );
    return {
      outcome: queued ? ("queued" as const) : ("applied" as const),
      conversationId: applied._id,
      contextVersion: applied.contextVersion,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Drain                                                               */
/* ------------------------------------------------------------------ */

/**
 * How stale a pending receipt must be before the drain re-drives it. Long
 * enough that the callback's own schedule, which runs at commit time, is not
 * raced by the cron.
 */
const DRAIN_MIN_AGE_MS = 2 * 60 * 1000;
/** Rows read per sweep. */
const DRAIN_SCAN_LIMIT = 200;
/** Rows re-driven per sweep. */
const DRAIN_DISPATCH_LIMIT = 50;

/**
 * Re-drive inbound receipts that never reached a terminal handling state —
 * the recovery path G3 asks for ("retain a small replay/reconciliation record
 * so failed callback handling is visible and recoverable").
 *
 * It exists because the callback that schedules handling cannot be retried:
 * Workpool does not retry mutations, and the component will not re-dispatch an
 * `event_id` it has already ingested. Without this, one lost schedule strands
 * a verified reply forever.
 *
 * Outbound delivery receipts also sit `pending` until `sending.ts` folds them
 * onto their attempt, so the scan is filtered to the inbound application-key
 * prefix — this sweep must never touch the send path's rows. It scans a wider
 * page than it dispatches so a run of outbound rows cannot starve the inbound
 * ones behind them. Each row is scheduled separately, not run inline, so one
 * poisoned receipt cannot roll back the whole sweep.
 */
export const drainPendingInboundReceipts = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), scheduled: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - DRAIN_MIN_AGE_MS;
    const stale = await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_handlingState_and_receivedAt", (q) =>
        q.eq("handlingState", "pending").lt("receivedAt", cutoff),
      )
      .take(DRAIN_SCAN_LIMIT);
    let scheduled = 0;
    for (const receipt of stale) {
      if (scheduled >= DRAIN_DISPATCH_LIMIT) {
        break;
      }
      if (!receipt.applicationKey.startsWith("incoming:")) {
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.inbox.applyInboundMessage, {
        receiptId: receipt._id,
      });
      scheduled += 1;
    }
    return { scanned: stale.length, scheduled };
  },
});
