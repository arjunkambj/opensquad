/**
 * The receipt-level half of inbound ingest: reading the bounded facts the
 * callback left on the receipt, settling it, and matching the message to a
 * conversation.
 *
 * EVERY INBOUND STRING IS DATA. Svix proved the payload came from the
 * provider untampered; it proved nothing about the content, which was written
 * by whoever sent the email. `in_reply_to`/`references` are not read at all —
 * they can name any message id, including another tenant's.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { boundedString, OPT_OUT_SIGNALS } from "../lib/validators";
import type { OptOutSignal } from "../lib/validators";

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
export type InboundFacts = {
  /** Normalized `From`, when the header named exactly one parseable address. */
  fromAddress?: string;
  /** Verdict of the deterministic opt-out rule, computed at the callback. */
  optOutSignal: OptOutSignal;
  /** Which rule fired — a rule NAME, never a slice of the message. */
  optOutRule?: string;
};

export function readInboundFacts(receipt: Doc<"emailEventReceipts">): InboundFacts {
  // `providerFacts` is `v.record(v.string(), v.any())`, so read it as
  // `unknown` and narrow — the column is a projection of provider data and
  // nothing here may trust its shape.
  const stored: Record<string, unknown> = receipt.providerFacts;
  const fromAddress = stored.fromAddress;
  const rawSignal = stored.optOutSignal;
  const rule = stored.optOutRule;
  return {
    ...(typeof fromAddress === "string" && fromAddress.length > 0
      ? { fromAddress }
      : {}),
    // A receipt written before the opt-out rule existed, or by any other
    // path, carries no verdict. `none` is the only safe default: it can never
    // manufacture a suppression, only fail to stop one, and the next message
    // on the thread re-evaluates.
    optOutSignal:
      typeof rawSignal === "string"
        ? (OPT_OUT_SIGNALS.find((candidate) => candidate === rawSignal) ??
          "none")
        : "none",
    ...(typeof rule === "string" && rule.length > 0 ? { optOutRule: rule } : {}),
  };
}

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
export async function fail(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  reason: string,
): Promise<{ outcome: "failed"; reason: string }> {
  await settleReceipt(ctx, receipt, "failed", reason);
  return { outcome: "failed", reason };
}

export async function settleReceipt(
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
export async function matchConversation(
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
