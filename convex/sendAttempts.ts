/**
 * Send attempts + provider event receipts (architecture §4.3, §8).
 *
 * This module owns the member-facing reads and the `emailEventReceipts`
 * write path. The send lifecycle itself (preflight, reserve, dispatch,
 * reconcile) lives in `sending.ts` — attempts here are only ever read.
 *
 * Receipts (§4.3): every verified provider event lands once per
 * `providerEventId` and once per `applicationKey`. Outbound delivery events
 * use `outbound:<providerMessageRef>:<eventType>`; inbound messages use
 * `incoming:<inboxRef>:<providerMessageRef>` so a provider re-delivery under
 * a new event id can never start a second reply mission. A delivery event
 * that arrives BEFORE the send attempt recorded its providerMessageRef stays
 * `pending`; `sending.ts` folds it onto the attempt afterwards. P11 consumes
 * pending inbound receipts fully.
 */
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./lib/auth";
import {
  boundedLimit,
  boundedString,
  domainError,
  invalid,
  PROVIDER_REF_MAX_LENGTH,
} from "./lib/validators";
import { emailEventReceiptFields, sendAttemptFields } from "./schema";

export const vSendAttemptDoc = v.object({
  _id: v.id("sendAttempts"),
  _creationTime: v.number(),
  ...sendAttemptFields,
});

export const vEmailEventReceiptDoc = v.object({
  _id: v.id("emailEventReceipts"),
  _creationTime: v.number(),
  ...emailEventReceiptFields,
});

/* ------------------------------------------------------------------ */
/* Public reads                                                        */
/* ------------------------------------------------------------------ */

/** One send attempt; foreign or cross-workspace IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    sendAttemptId: v.id("sendAttempts"),
  },
  returns: vSendAttemptDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null || attempt.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    return attempt;
  },
});

/** Attempts recorded for one draft revision (one logical send, bounded). */
export const listForDraft = query({
  args: {
    workspaceId: v.id("workspaces"),
    draftId: v.id("drafts"),
    limit: v.optional(v.number()),
  },
  returns: v.array(vSendAttemptDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null || draft.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "draft not found");
    }
    return await ctx.db
      .query("sendAttempts")
      .withIndex("by_draftId", (q) => q.eq("draftId", args.draftId))
      .order("desc")
      .take(boundedLimit(args.limit));
  },
});

/** Attempts across all revisions of a conversation (audit surface). */
export const listForConversation = query({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    state: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(vSendAttemptDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (
      conversation === null ||
      conversation.workspaceId !== args.workspaceId
    ) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const limit = boundedLimit(args.limit);
    if (args.state !== undefined) {
      return await ctx.db
        .query("sendAttempts")
        .withIndex("by_conversationId_and_state", (q) =>
          q
            .eq("conversationId", args.conversationId)
            .eq("state", args.state as Doc<"sendAttempts">["state"]),
        )
        .order("desc")
        .take(limit);
    }
    // No state filter → newest-first audit order (the state index would
    // return state-bucketed groups, not chronology).
    return await ctx.db
      .query("sendAttempts")
      .withIndex("by_conversationId_and_createdAt", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(limit);
  },
});

/** Recent provider event receipts for the workspace (member read). */
export const listReceipts = query({
  args: {
    workspaceId: v.id("workspaces"),
    providerMessageRef: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(vEmailEventReceiptDoc),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const providerMessageRef = args.providerMessageRef;
    if (providerMessageRef !== undefined) {
      // by_providerMessageRef is a global index — the workspace filter is
      // applied in the query so a known ref can never read across tenants.
      return await ctx.db
        .query("emailEventReceipts")
        .withIndex("by_providerMessageRef", (q) =>
          q.eq("providerMessageRef", providerMessageRef),
        )
        .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
        .order("desc")
        .take(limit);
    }
    // Workspace scan via the application-key index prefix.
    return await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_workspaceId_and_applicationKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .order("desc")
      .take(limit);
  },
});

/* ------------------------------------------------------------------ */
/* Internal reads (sending.ts's evidence/reconcile paths)                */
/* ------------------------------------------------------------------ */

/** Attempt doc for internal actions — no auth (internal boundary only). */
export const getInternal = internalQuery({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: v.union(vSendAttemptDoc, v.null()),
  handler: async (ctx, args) =>
    await ctx.db.get("sendAttempts", args.sendAttemptId),
});

/**
 * Every receipt bearing on one attempt — keyed by its provider message ref
 * (receipts fold onto attempts through that ref, so handled and pending
 * rows alike live on this index).
 */
export const receiptsForAttempt = internalQuery({
  args: { sendAttemptId: v.id("sendAttempts") },
  returns: v.array(vEmailEventReceiptDoc),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    const providerMessageRef = attempt?.providerMessageRef;
    if (providerMessageRef === undefined) {
      return [];
    }
    return await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_providerMessageRef", (q) =>
        q.eq("providerMessageRef", providerMessageRef),
      )
      .collect();
  },
});

/* ------------------------------------------------------------------ */
/* Receipt write path — internal; P11's webhook handler calls this       */
/* ------------------------------------------------------------------ */

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
  // acknowledgement path in sending.ts.
  if (!duplicateApplicationKey) {
    const attempt = await ctx.db
      .query("sendAttempts")
      .withIndex("by_providerMessageRef", (q) =>
        q.eq("providerMessageRef", providerMessageRef),
      )
      .unique();
    if (attempt !== null && attempt.workspaceId === args.workspaceId) {
      await applyReceiptToAttempt(ctx, receipt, attempt._id);
    }
  }

  return { receipt, duplicate: false, duplicateApplicationKey };
}

/**
 * Fold one pending delivery receipt onto a send attempt: merge its verified
 * facts into `providerDeliveryFacts` and mark the receipt handled. Called by
 * `sending.ts` when an attempt records its providerMessageRef and by the
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
  await ctx.db.patch("sendAttempts", attemptId, {
    providerDeliveryFacts: {
      ...existing,
      lastEventType: receipt.eventType,
      lastEventAt: eventAt,
      ...(stamp !== undefined ? { [stamp]: eventAt } : {}),
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
      await ctx.runMutation(internal.suppressions.recordSuppression, {
        workspaceId: attempt.workspaceId,
        kind: "email",
        value: draft.normalizedRecipient,
        reason: receipt.eventType === "message.bounced" ? "bounce" : "provider",
        sourceConversationId: attempt.conversationId,
      });
    }
  }
}
