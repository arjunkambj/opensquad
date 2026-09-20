/**
 * Ownership, takeover and lifecycle: who is handling a thread, whether the
 * agent may still act on it, and when it is closed, reopened or read.
 *
 * Taking over is what stops automation; closing is a human verdict. Neither
 * is ever inferred from message content.
 */
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { boundedString, domainError, invalid } from "../lib/validators";
import {
  getConversationInOrg,
  vConversationDoc,
} from "../outreach/draftsModel";
import { recordConversationNote } from "./conversationNotes";
import { advanceContext, assertContextVersion } from "./conversationsModel";
import { v } from "convex/values";

/**
 * Freeze automation on a thread (§5 `setTakeover`).
 *
 * `enabled: false` is REFUSED. Architecture §8 requires an unfreeze to
 * validate the association, the verified sender/contact match, the campaign
 * and the current policy; a boolean that skipped all four would be a hole, so
 * there is exactly one unfreeze path and it is the checked one —
 * `conversations.resume`.
 */
export const setTakeover = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    if (!args.enabled) {
      throw invalid(
        "clearing takeover re-runs the policy checks — call conversations.resume",
      );
    }
    // Idempotent retry: already frozen returns the doc, because checking the
    // version first would CONFLICT a retried request.
    if (conversation.humanTakeover) {
      return conversation;
    }
    assertContextVersion(conversation, args.expectedContextVersion);
    const reason =
      args.reason === undefined
        ? undefined
        : boundedString(args.reason, "reason", { min: 1, max: 500 });
    const updated = await advanceContext(
      ctx,
      conversation,
      {
        humanTakeover: true,
        takeoverReason: "operator",
        takeoverBy: identityKey,
        takeoverAt: Date.now(),
      },
      "an operator took the conversation over",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body:
        reason === undefined
          ? "Human takeover enabled; automation is frozen."
          : `Human takeover enabled; automation is frozen. ${reason}`,
    });
    return updated;
  },
});

/**
 * Assign the HUMAN who owns this thread, or clear the assignment by omitting
 * `assigneeIdentityKey`.
 *
 * The assignee is the CALLER, or nobody. Who else belongs to the
 * organization lives with the auth provider, not in our data, so the caller's
 * own verified identity is the only one this transaction can confirm is a
 * member. Any other identity is a bad argument, not a hidden row, so it is
 * INVALID rather than NOT_FOUND.
 */
export const assignOwner = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    assigneeIdentityKey: v.optional(v.string()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    const next =
      args.assigneeIdentityKey === undefined
        ? undefined
        : boundedString(args.assigneeIdentityKey, "assigneeIdentityKey", {
            min: 1,
            max: 300,
          });
    if (next !== undefined && next !== identityKey) {
      throw invalid("a conversation can only be assigned to its caller");
    }
    if (conversation.assigneeIdentityKey === next) {
      return conversation;
    }
    assertContextVersion(conversation, args.expectedContextVersion);
    const updated = await advanceContext(
      ctx,
      conversation,
      { assigneeIdentityKey: next },
      "the conversation owner changed",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body:
        next === undefined
          ? "Conversation owner cleared."
          : "Conversation owner assigned.",
    });
    return updated;
  },
});

/** Close a thread. Automation refuses a non-open conversation outright. */
export const close = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    if (conversation.state === "closed") {
      return conversation;
    }
    assertContextVersion(conversation, args.expectedContextVersion);
    const updated = await advanceContext(
      ctx,
      conversation,
      { state: "closed" },
      "the conversation was closed",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body: "Conversation closed.",
    });
    return updated;
  },
});

/**
 * Reopen a closed thread.
 *
 * Without this a closed conversation that receives new mail is a dead end —
 * architecture §8 forbids auto-reopening, because state changes are human, so
 * the human needs the door. Reopening keeps takeover ON: re-arming automation
 * is a separate act, and it is `resume`, which re-runs the policy checks.
 */
export const reopen = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    if (conversation.state === "open") {
      return conversation;
    }
    if (conversation.state !== "closed") {
      throw domainError(
        "CONFLICT",
        `conversation is ${conversation.state}; only a closed conversation can reopen`,
      );
    }
    assertContextVersion(conversation, args.expectedContextVersion);
    const updated = await advanceContext(
      ctx,
      conversation,
      {
        state: "open",
        humanTakeover: true,
        takeoverReason: "awaiting_resume",
        takeoverBy: identityKey,
        takeoverAt: Date.now(),
      },
      "the conversation was reopened",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body:
        "Conversation reopened under human takeover; resume re-arms automation.",
    });
    return updated;
  },
});

/**
 * Clear the unread counter (§5 `markRead`).
 *
 * MEMBER-level on purpose, and the one write here that does NOT advance
 * `contextVersion`: `unreadCount` is a single shared org counter, and
 * having read a thread is not a fact that invalidates a draft. Bumping the
 * version here would make every open approval stale each time someone opened
 * the inbox.
 */
export const markRead = mutation({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    if (conversation.unreadCount === 0) {
      return conversation;
    }
    await ctx.db.patch("conversations", conversation._id, {
      unreadCount: 0,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get("conversations", conversation._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    return updated;
  },
});
