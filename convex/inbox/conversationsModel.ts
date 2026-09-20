/**
 * Conversation DTOs and the shared read helpers behind them.
 *
 * The projections here are what the inbox screens render — never a raw
 * provider row: a thread entry carries only verified, bounded facts, and
 * `resolveOutboundRecipient` is the single place the address we would reply
 * to is derived.
 */
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AuthCtx } from "../lib/auth";
import {
  domainError,
  normalizeEmailAddress,
  vAgentMode,
  vConversationState,
  vLeadStage,
  vReplyDisposition,
  vTakeoverReason,
} from "../lib/validators";
import { vSendResultCode } from "../outreach/sendGates";
import { v } from "convex/values";

/** The lead behind a thread, projected to what a row or header renders. */
export const vConversationProspectRef = v.object({
  prospectId: v.id("prospects"),
  /** Absent when the sourced row carried no company name. */
  companyName: v.optional(v.string()),
  stage: vLeadStage,
});

/** The agent a thread's reply work runs under. */
export const vConversationAgentRef = v.object({
  agentId: v.id("agents"),
  name: v.string(),
  mode: vAgentMode,
});

/**
 * One inbox row. `plan/ux.md` §165 asks a row to show the lead, the assigned
 * the classification tag and "Draft ready"; resolving that here
 * costs one indexed point read per listed conversation, against N client
 * round trips if the UI had to join it itself.
 */
export const vConversationSummary = v.object({
  conversationId: v.id("conversations"),
  state: vConversationState,
  humanTakeover: v.boolean(),
  takeoverReason: v.optional(vTakeoverReason),
  takeoverAt: v.optional(v.number()),
  contextVersion: v.number(),
  unreadCount: v.number(),
  assigneeIdentityKey: v.optional(v.string()),
  lastDisposition: v.optional(vReplyDisposition),
  lastDispositionAt: v.optional(v.number()),
  lastMessageAt: v.optional(v.number()),
  lastInboundAt: v.optional(v.number()),
  lastInboundFrom: v.optional(v.string()),
  hasDraft: v.boolean(),
  currentDraftId: v.optional(v.id("drafts")),
  prospect: v.union(vConversationProspectRef, v.null()),
  updatedAt: v.number(),
});

export type ConversationSummary = typeof vConversationSummary.type;

/**
 * One entry in the merged thread timeline. A pending draft is a distinct
 * variant, never an outbound message wearing a state — `plan/ux.md` §172 ③
 * forbids rendering it in the position or style of something that was sent.
 *
 * Bodies are plain text only. `html` is never projected, which removes raw
 * HTML injection and remote tracking-image loads at the source rather than
 * leaving it to the renderer.
 */
export const vThreadEntry = v.union(
  v.object({
    kind: v.literal("inbound"),
    messageRef: v.string(),
    at: v.number(),
    fromDisplay: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.string(),
  }),
  v.object({
    kind: v.literal("outbound"),
    draftId: v.id("drafts"),
    revision: v.number(),
    subject: v.string(),
    body: v.string(),
    state: v.union(v.literal("draft"), vSendResultCode),
    at: v.number(),
    sendAttemptId: v.optional(v.id("sendAttempts")),
    deliveredAt: v.optional(v.number()),
    bouncedAt: v.optional(v.number()),
  }),
);

export type ThreadEntry = typeof vThreadEntry.type;

/**
 * Project a conversation row down to an inbox row, resolving the lead.
 * The prospect is re-checked against the conversation's own org: a
 * dangling or foreign id renders as no lead rather than quoting a row from
 * another org into this feed.
 */
export async function summarize(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
): Promise<ConversationSummary> {
  const prospect =
    conversation.prospectId === undefined
      ? null
      : await ctx.db.get("prospects", conversation.prospectId);
  return {
    conversationId: conversation._id,
    state: conversation.state,
    humanTakeover: conversation.humanTakeover,
    takeoverReason: conversation.takeoverReason,
    takeoverAt: conversation.takeoverAt,
    contextVersion: conversation.contextVersion,
    unreadCount: conversation.unreadCount,
    assigneeIdentityKey: conversation.assigneeIdentityKey,
    lastDisposition: conversation.lastDisposition,
    lastDispositionAt: conversation.lastDispositionAt,
    lastMessageAt: conversation.lastMessageAt,
    lastInboundAt: conversation.lastInboundAt,
    lastInboundFrom: conversation.lastInboundFrom,
    hasDraft: conversation.currentDraftId !== undefined,
    currentDraftId: conversation.currentDraftId,
    prospect:
      prospect === null || prospect.orgId !== conversation.orgId
        ? null
        : {
            prospectId: prospect._id,
            ...(prospect.companyName === undefined
              ? {}
              : { companyName: prospect.companyName }),
            stage: prospect.stage,
          },
    updatedAt: conversation.updatedAt,
  };
}

/**
 * The address this thread would actually be mailed at, resolved entirely by
 * the application — and the latest revision it was resolved against.
 *
 * ONE definition, because three callers need the same answer and they must not
 * disagree: `resume`'s sender/contact check, the inbound opt-out rule's
 * suppression target, and the reply-automation gate. The lead's contact wins;
 * the last revision's `normalizedRecipient` is the fallback for a thread whose
 * lead has no contact yet.
 *
 * It is NEVER read from an inbound payload. An inbound `from` can at most be
 * compared against this and cause a refusal.
 */
export async function resolveOutboundRecipient(
  ctx: AuthCtx,
  conversation: Doc<"conversations">,
): Promise<{ recipient: string | null; latestDraft: Doc<"drafts"> | null }> {
  const latestDraft = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_revision", (q) =>
      q.eq("conversationId", conversation._id),
    )
    .order("desc")
    .first();
  let recipient: string | null = null;
  if (conversation.prospectId !== undefined) {
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    const email = prospect?.email;
    if (
      prospect !== null &&
      prospect.orgId === conversation.orgId &&
      email !== undefined
    ) {
      try {
        recipient = normalizeEmailAddress(email, "recipient");
      } catch {
        recipient = null;
      }
    }
  }
  if (recipient === null && latestDraft !== null) {
    recipient = latestDraft.normalizedRecipient;
  }
  return { recipient, latestDraft };
}

/**
 * Trim an untrusted provider string to a bound. Unlike `boundedString` this
 * never throws: a malformed field on one inbound row must degrade that row,
 * not fail the whole thread read.
 */
export function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * The optimistic-concurrency check every versioned mutation shares. It runs
 * AFTER the target-state check, so a retried request that already committed
 * returns the doc rather than a spurious CONFLICT.
 */
export function assertContextVersion(
  conversation: Doc<"conversations">,
  expected: number,
): void {
  if (conversation.contextVersion !== expected) {
    throw domainError(
      "CONFLICT",
      `conversation context is v${conversation.contextVersion}, not v${expected}`,
    );
  }
}

/**
 * Apply a context-changing patch: advance `contextVersion` by exactly one and
 * retire the work that was authorized against the old one.
 *
 * Both halves are mandatory together. The bump is what makes a live approval
 * stale at preflight (`context_changed`); retiring is what releases a
 * `reserved` attempt's usage reservation. Doing only the first leaves a
 * thread that can never be worked again.
 */
export async function advanceContext(
  ctx: MutationCtx,
  conversation: Doc<"conversations">,
  patch: Partial<Doc<"conversations">>,
  reason: string,
): Promise<Doc<"conversations">> {
  await ctx.db.patch("conversations", conversation._id, {
    ...patch,
    contextVersion: conversation.contextVersion + 1,
    updatedAt: Date.now(),
  });
  await ctx.runMutation(internal.outreach.conversationStaging.retireConversationWork, {
    conversationId: conversation._id,
    reason,
  });
  const updated = await ctx.db.get("conversations", conversation._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "conversation not found");
  }
  return updated;
}
