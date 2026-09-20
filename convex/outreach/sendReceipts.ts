/**
 * Provider event receipts — the `emailEventReceipts` write path (§4.3).
 *
 * Every verified provider event lands once per `providerEventId` and once
 * per `applicationKey`. Outbound delivery events use
 * `outbound:<providerMessageRef>:<eventType>`; inbound messages use
 * `incoming:<inboxRef>:<providerMessageRef>` so a provider re-delivery under
 * a new event id can never advance the conversation twice. A delivery event
 * that arrives BEFORE the send attempt recorded its providerMessageRef stays
 * `pending`; the send outcome path folds it onto the attempt afterwards.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import {
  boundedString,
  directionForApplicationKey,
  domainError,
  invalid,
  PROVIDER_REF_MAX_LENGTH,
  vMessageSource,
} from "../lib/validators";
import type { MessageSource } from "../lib/validators";
import { vEmailEventReceiptDoc } from "./sendAttempts";
import { v } from "convex/values";

export const PROVIDER_FACTS_MAX_BYTES = 4096;

export const RECEIPT_EVENT_IDS_MAX = 10;

const vRecordReceiptResult = v.object({
  receipt: vEmailEventReceiptDoc,
  /** `true` when this providerEventId was already recorded. */
  duplicate: v.boolean(),
  /** `true` when the applicationKey was already claimed — the receipt is
   *  recorded as `handled` and must never start business handling. */
  duplicateApplicationKey: v.boolean(),
});

/**
 * Record one verified provider event. Dedupes transactionally on
 * `providerEventId` (delivery) and `(workspaceId, applicationKey)` (business
 * effect). `providerFacts` must be a bounded projection of verified fields —
 * never a message body — capped at PROVIDER_FACTS_MAX_BYTES.
 */
export const recordProviderEvent = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    providerEventId: v.string(),
    applicationKey: v.string(),
    providerMessageRef: v.string(),
    eventType: v.string(),
    /** Live webhook unless the connect-time backfill says otherwise. */
    source: v.optional(vMessageSource),
    providerFacts: v.optional(v.record(v.string(), v.any())),
    providerThreadRef: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
  },
  returns: vRecordReceiptResult,
  handler: async (ctx, args) => {
    return await recordReceipt(ctx, args);
  },
});

export async function recordReceipt(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    inboxRef: string;
    providerEventId: string;
    applicationKey: string;
    providerMessageRef: string;
    eventType: string;
    source?: MessageSource;
    providerFacts?: Record<string, unknown>;
    providerThreadRef?: string;
    receivedAt?: number;
  },
): Promise<{
  receipt: Doc<"emailEventReceipts">;
  duplicate: boolean;
  duplicateApplicationKey: boolean;
}> {
  const providerEventId = boundedString(
    args.providerEventId,
    "providerEventId",
    { min: 1, max: 200 },
  );
  const applicationKey = boundedString(args.applicationKey, "applicationKey", {
    min: 1,
    max: 500,
  });
  const providerMessageRef = boundedString(
    args.providerMessageRef,
    "providerMessageRef",
    { min: 1, max: PROVIDER_REF_MAX_LENGTH },
  );
  const eventType = boundedString(args.eventType, "eventType", {
    min: 1,
    max: 100,
  });
  const inboxRef = boundedString(args.inboxRef, "inboxRef", {
    min: 1,
    max: PROVIDER_REF_MAX_LENGTH,
  });
  const facts = args.providerFacts ?? {};
  if (
    JSON.stringify(facts).length > PROVIDER_FACTS_MAX_BYTES
  ) {
    throw invalid("providerFacts exceeds the 4 KiB bound");
  }

  // Delivery dedupe: one row per provider event id, ever.
  const byEvent = await ctx.db
    .query("emailEventReceipts")
    .withIndex("by_providerEventId", (q) =>
      q.eq("providerEventId", providerEventId),
    )
    .unique();
  if (byEvent !== null) {
    return {
      receipt: byEvent,
      duplicate: true,
      duplicateApplicationKey: false,
    };
  }

  // Application-key dedupe: a second event id for the same logical effect
  // (e.g. provider re-delivery of one inbound message) is recorded but
  // marked handled so P11 never runs its business path twice. `.first()`,
  // not `.unique()` — once a second row exists for the key (marked
  // `handled`), a third delivery must still record, not throw and wedge.
  const byKey = await ctx.db
    .query("emailEventReceipts")
    .withIndex("by_workspaceId_and_applicationKey", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("applicationKey", applicationKey),
    )
    .first();
  const duplicateApplicationKey = byKey !== null;

  const now = Date.now();
  const receiptId = await ctx.db.insert("emailEventReceipts", {
    workspaceId: args.workspaceId,
    inboxRef,
    providerEventId,
    applicationKey,
    providerMessageRef,
    eventType,
    receivedAt: args.receivedAt ?? now,
    // PLAN §9.4: the reply gate answers `live` mail only. Every writer that
    // is not the connect-time backfill is recording live mail, so `live` is
    // the default and `backfill` is stated explicitly.
    source: args.source ?? "live",
    // Derived from the key, never passed in: the key already names the half
    // of the mail path this row belongs to, and two independent statements of
    // one fact is how the drain's index range would come to disagree with the
    // prefix it replaced.
    direction: directionForApplicationKey(applicationKey),
    handlingState: duplicateApplicationKey ? "handled" : "pending",
    providerFacts: facts,
    ...(args.providerThreadRef !== undefined
      ? {
          providerThreadRef: boundedString(
            args.providerThreadRef,
            "providerThreadRef",
            { min: 1, max: PROVIDER_REF_MAX_LENGTH },
          ),
        }
      : {}),
    ...(duplicateApplicationKey
      ? { handledAt: now, error: "duplicate_application_key" }
      : {}),
  });
  const receipt = await ctx.db.get("emailEventReceipts", receiptId);
  if (receipt === null) {
    throw domainError("NOT_FOUND", "receipt not found after insert");
  }

  // Late delivery event: the attempt already recorded its providerMessageRef
  // — fold the verified facts on immediately instead of parking. Inbound
  // receipts never match a send attempt, so this only touches delivery
  // facts. Early events (no attempt yet) stay `pending` for the
  // acknowledgement path in sendOutcome.ts.
  if (!duplicateApplicationKey) {
    // .collect() not .unique(): a provider anomaly could put the same
    // message ref on two attempts — unique() would throw and wedge the
    // receipt forever. The workspace check picks our attempt out of any
    // such collision.
    const candidates = await ctx.db
      .query("sendAttempts")
      .withIndex("by_providerMessageRef", (q) =>
        q.eq("providerMessageRef", providerMessageRef),
      )
      .collect();
    const attempt = candidates.find(
      (candidate) => candidate.workspaceId === args.workspaceId,
    );
    if (attempt !== undefined) {
      await applyReceiptToAttempt(ctx, receipt, attempt._id);
    }
  }

  return { receipt, duplicate: false, duplicateApplicationKey };
}

/**
 * Fold one pending delivery receipt onto a send attempt: merge its verified
 * facts into `providerDeliveryFacts` and mark the receipt handled. Called by
 * `sendOutcome.ts` when an attempt records its providerMessageRef and by the
 * receipt path when the attempt already carries it.
 */
export async function applyReceiptToAttempt(
  ctx: MutationCtx,
  receipt: Doc<"emailEventReceipts">,
  attemptId: Id<"sendAttempts">,
): Promise<void> {
  const attempt = await ctx.db.get("sendAttempts", attemptId);
  if (attempt === null) {
    return;
  }
  const facts = receipt.providerFacts;
  const eventAt =
    typeof facts.timestamp === "number" ? facts.timestamp : receipt.receivedAt;
  const existing = attempt.providerDeliveryFacts ?? {};
  const eventIds = [
    ...(existing.eventIds ?? []),
    receipt.providerEventId,
  ].slice(-RECEIPT_EVENT_IDS_MAX);
  const fieldFor = (eventType: string) =>
    eventType === "message.delivered"
      ? "deliveredAt"
      : eventType === "message.bounced"
        ? "bouncedAt"
        : eventType === "message.complained"
          ? "complainedAt"
          : eventType === "message.rejected"
            ? "rejectedAt"
            : undefined;
  const stamp = fieldFor(receipt.eventType);
  // Out-of-order signed delivery is real, not theoretical: the P05 gate
  // observed `message.delivered` arriving BEFORE `message.sent` for one
  // message. So the summary pair advances only forward, and each per-type
  // stamp records the FIRST verified occurrence of that fact and is never
  // overwritten. Without this an older `message.sent` landing after a newer
  // `message.bounced` would present the attempt as merely sent — exactly the
  // regression V16 step 1 tests.
  //
  // The attempt's own `state` is never derived from these facts, so transport
  // state proper was already safe; this is about the delivery summary the UI
  // and the reconcile path read.
  const advancesSummary =
    existing.lastEventAt === undefined || eventAt >= existing.lastEventAt;
  await ctx.db.patch("sendAttempts", attemptId, {
    providerDeliveryFacts: {
      ...existing,
      ...(advancesSummary
        ? { lastEventType: receipt.eventType, lastEventAt: eventAt }
        : {}),
      ...(stamp !== undefined && existing[stamp] === undefined
        ? { [stamp]: eventAt }
        : {}),
      eventIds,
    },
    updatedAt: Date.now(),
  });
  await ctx.db.patch("emailEventReceipts", receipt._id, {
    handlingState: "handled",
    handledAt: Date.now(),
  });

  // Safety net (§8.6/G3 step 9): verified bounce/complaint facts suppress the
  // exact email — never the domain. Idempotent via the suppression's unique
  // key. P11's inbound module may apply richer rules on top.
  if (
    receipt.eventType === "message.bounced" ||
    receipt.eventType === "message.complained"
  ) {
    const draft = await ctx.db.get("drafts", attempt.draftId);
    if (draft !== null) {
      await ctx.runMutation(internal.outreach.suppressions.recordSuppression, {
        workspaceId: attempt.workspaceId,
        kind: "email",
        value: draft.normalizedRecipient,
        reason: receipt.eventType === "message.bounced" ? "bounce" : "provider",
        sourceConversationId: attempt.conversationId,
      });
    }
  }
}
