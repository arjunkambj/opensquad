/**
 * Send attempts — the member-facing read surface over `sendAttempts`
 * (architecture §4.3, §8).
 *
 * The send lifecycle itself (preflight, reserve, dispatch, reconcile) lives
 * in the send* modules beside this one; attempts here are only ever read.
 */
import { internalQuery, query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  boundedLimit,
  domainError,
  vSendAttemptState,
} from "../lib/validators";
import { emailEventReceiptFields, sendAttemptFields } from "../schema";
import { v } from "convex/values";

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

/** One send attempt; foreign or cross-org IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    orgId: v.id("orgs"),
    sendAttemptId: v.id("sendAttempts"),
  },
  returns: vSendAttemptDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null || attempt.orgId !== args.orgId) {
      throw domainError("NOT_FOUND", "send attempt not found");
    }
    return attempt;
  },
});

/** Attempts recorded for one draft revision (one logical send, bounded). */
export const listForDraft = query({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
    limit: v.optional(v.number()),
  },
  returns: v.array(vSendAttemptDoc),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const draft = await ctx.db.get("drafts", args.draftId);
    if (draft === null || draft.orgId !== args.orgId) {
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
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    state: v.optional(vSendAttemptState),
    limit: v.optional(v.number()),
  },
  returns: v.array(vSendAttemptDoc),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (
      conversation === null ||
      conversation.orgId !== args.orgId
    ) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    const limit = boundedLimit(args.limit);
    const state = args.state;
    if (state !== undefined) {
      return await ctx.db
        .query("sendAttempts")
        .withIndex("by_conversationId_and_state", (q) =>
          q
            .eq("conversationId", args.conversationId)
            .eq("state", state),
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

/** Recent provider event receipts for the org (member read). */
export const listReceipts = query({
  args: {
    orgId: v.id("orgs"),
    providerMessageRef: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(vEmailEventReceiptDoc),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const limit = boundedLimit(args.limit);
    const providerMessageRef = args.providerMessageRef;
    if (providerMessageRef !== undefined) {
      // by_providerMessageRef is a global index — the org filter is
      // applied in the query so a known ref can never read across tenants.
      return await ctx.db
        .query("emailEventReceipts")
        .withIndex("by_providerMessageRef", (q) =>
          q.eq("providerMessageRef", providerMessageRef),
        )
        .filter((q) => q.eq(q.field("orgId"), args.orgId))
        .order("desc")
        .take(limit);
    }
    // Org scan via the application-key index prefix.
    return await ctx.db
      .query("emailEventReceipts")
      .withIndex("by_orgId_and_applicationKey", (q) =>
        q.eq("orgId", args.orgId),
      )
      .order("desc")
      .take(limit);
  },
});

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
