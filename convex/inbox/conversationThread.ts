/**
 * The thread read: our own sent revisions interleaved with the verified
 * inbound messages the provider component holds, bounded and clipped.
 */
import { components } from "../_generated/api";
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  boundedLimit,
  PROVIDER_REF_MAX_LENGTH,
  THREAD_BODY_MAX_LENGTH,
} from "../lib/validators";
import { getConversationInOrg } from "../outreach/draftsModel";
import { sendResultCode } from "../outreach/sendGates";
import { clip, vThreadEntry } from "./conversationsModel";
import type { ThreadEntry } from "./conversationsModel";
import { v } from "convex/values";

/**
 * The merged thread timeline, newest first — §5's "Authorize message
 * component access", made callable.
 *
 * Inbound bodies come from the AgentMail component (the owner of inbound
 * message storage) and are selected by the conversation's OWN
 * `providerThreadRef`, then filtered to its own `inboxRef`: the component's
 * `by_thread` index is global and AgentMail thread ids are per-inbox, so the
 * inbox filter is what keeps a colliding thread id in another inbox out of
 * this org's feed.
 *
 * Outbound entries are the immutable draft revisions joined to their send
 * attempt through `sendAttempts.by_draftId` — one logical send per revision
 * (§8.3), so this is a small point read per listed revision rather than a
 * scan of the conversation's attempts.
 *
 * Honest limit: the component's `listInboundMessages({threadId})` is an
 * unbounded `.collect()` inside the component, and the package exposes no
 * by-messageId accessor to page it with, so a pathologically long thread can
 * approach the Convex read limit before this query sees the rows. The merged
 * timeline therefore returns no cursor — two heterogeneous sources cannot
 * honestly share one opaque cursor — and `drafts.listForConversation` remains
 * the real cursor for the outbound half.
 */
export const thread = query({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vThreadEntry),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    const limit = boundedLimit(args.limit);
    const entries: ThreadEntry[] = [];

    if (conversation.providerThreadRef !== undefined) {
      const inbound = (await ctx.runQuery(
        components.agentmail.lib.listInboundMessages,
        { threadId: conversation.providerThreadRef },
      )) as Array<Record<string, unknown>>;
      for (const row of inbound) {
        if (row.inboxId !== conversation.inboxRef) {
          continue;
        }
        const messageRef = clip(row.messageId, PROVIDER_REF_MAX_LENGTH);
        if (messageRef === undefined) {
          continue;
        }
        entries.push({
          kind: "inbound",
          messageRef,
          // The provider timestamp is a display fact only. The component's
          // parser silently falls back to `Date.now()` when it cannot parse
          // one, so it is never an ordering authority anywhere that matters.
          at: typeof row.timestamp === "number" ? row.timestamp : 0,
          fromDisplay: clip(row.from, 320),
          subject: clip(row.subject, 200),
          body:
            clip(row.extractedText, THREAD_BODY_MAX_LENGTH) ??
            clip(row.text, THREAD_BODY_MAX_LENGTH) ??
            clip(row.preview, THREAD_BODY_MAX_LENGTH) ??
            "",
        });
      }
    }

    // One more than the page, so a truncated outbound half still reports
    // `hasMore` honestly.
    const revisions = await ctx.db
      .query("drafts")
      .withIndex("by_conversationId_and_revision", (q) =>
        q.eq("conversationId", conversation._id),
      )
      .order("desc")
      .take(limit + 1);
    for (const draft of revisions) {
      const attempts = await ctx.db
        .query("sendAttempts")
        .withIndex("by_draftId", (q) => q.eq("draftId", draft._id))
        .collect();
      const attempt =
        attempts.length === 0
          ? null
          : attempts.reduce((newest, candidate) =>
              candidate.createdAt >= newest.createdAt ? candidate : newest,
            );
      const facts = attempt?.providerDeliveryFacts;
      entries.push({
        kind: "outbound",
        draftId: draft._id,
        revision: draft.revision,
        subject: draft.subject,
        body: draft.body,
        state: attempt === null ? "draft" : sendResultCode(attempt),
        at: attempt?.createdAt ?? draft.createdAt,
        sendAttemptId: attempt?._id,
        deliveredAt: facts?.deliveredAt,
        bouncedAt: facts?.bouncedAt,
      });
    }

    entries.sort((a, b) => b.at - a.at);
    return {
      items: entries.slice(0, limit),
      hasMore: entries.length > limit,
    };
  },
});
