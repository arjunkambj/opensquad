/**
 * Conversations — the shared workspace inbox (architecture §4.3/§5, P11).
 *
 * A conversation is the app's own record of one email thread: who owns it,
 * which lead and campaign it is bound to, whether automation is frozen, and
 * what version of its context any draft was written against. It is NOT a
 * message store. §4.3 forbids a second messages table, so the thread view
 * composes three sources it keeps no copy of:
 *
 *   - inbound bodies — read through the AgentMail component, keyed by THIS
 *     conversation's own `inboxRef`/`providerThreadRef` after the workspace
 *     guard, never by a caller-supplied inbox or thread id;
 *   - outbound content — the immutable `drafts` revisions;
 *   - outbound state — `sendAttempts` and the verified delivery facts folded
 *     onto them.
 *
 * Every inbound string reaching this module — sender, subject, body — is
 * data, never instruction. Svix proved the payload came from AgentMail
 * untampered; it proved nothing about who wrote the content. Bodies are
 * returned as plain text only and are never interpolated into anything that
 * reads as an instruction.
 *
 * Reads take `requireWorkspaceMember`; state changes take
 * `requireWorkspaceEditor`, which is what refuses a viewer.
 */
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceMember } from "./lib/auth";
import {
  boundedLimit,
  PROVIDER_REF_MAX_LENGTH,
  THREAD_BODY_MAX_LENGTH,
  vCampaignStatus,
  vConversationState,
  vConversationTab,
  vReplyDisposition,
  vSalesStage,
  vTakeoverReason,
} from "./lib/validators";
import { getConversationInWorkspace, vConversationDoc } from "./drafts";
import { sendResultCode, vSendResultCode } from "./sending";

/* ------------------------------------------------------------------ */
/* DTOs — projections the inbox screens need, never raw provider rows  */
/* ------------------------------------------------------------------ */

/** The lead behind a thread, projected to what a row or header renders. */
export const vConversationProspectRef = v.object({
  prospectId: v.id("prospects"),
  companyName: v.string(),
  salesStage: vSalesStage,
});

/** The campaign a thread's reply work runs under. */
export const vConversationCampaignRef = v.object({
  campaignId: v.id("campaigns"),
  title: v.string(),
  status: vCampaignStatus,
});

/**
 * One inbox row. `plan/ux.md` §165 asks a row to show the lead, the assigned
 * employee, the classification tag and "Draft ready"; resolving that here
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
  employeeId: v.id("employees"),
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

/* ------------------------------------------------------------------ */
/* Shared read helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Project a conversation row down to an inbox row, resolving the lead.
 * The prospect is re-checked against the conversation's own workspace: a
 * dangling or foreign id renders as no lead rather than quoting a row from
 * another workspace into this feed.
 */
async function summarize(
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
    employeeId: conversation.employeeId,
    assigneeIdentityKey: conversation.assigneeIdentityKey,
    lastDisposition: conversation.lastDisposition,
    lastDispositionAt: conversation.lastDispositionAt,
    lastMessageAt: conversation.lastMessageAt,
    lastInboundAt: conversation.lastInboundAt,
    lastInboundFrom: conversation.lastInboundFrom,
    hasDraft: conversation.currentDraftId !== undefined,
    currentDraftId: conversation.currentDraftId,
    prospect:
      prospect === null || prospect.workspaceId !== conversation.workspaceId
        ? null
        : {
            prospectId: prospect._id,
            companyName: prospect.companyName,
            salesStage: prospect.salesStage,
          },
    updatedAt: conversation.updatedAt,
  };
}

/**
 * Trim an untrusted provider string to a bound. Unlike `boundedString` this
 * never throws: a malformed field on one inbound row must degrade that row,
 * not fail the whole thread read.
 */
function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * The inbox list, one exact index range per tab (`plan/ux.md` §48/§165).
 *
 * `open`/`unassigned`/`closed` slice
 * `by_workspaceId_and_state_and_lastMessageAt`; `takeover` slices
 * `by_workspaceId_and_humanTakeover_and_lastMessageAt`. No tab post-filters a
 * page — a post-filtered truncated page is not a filtered result (§5).
 *
 * The `takeover` tab is every frozen thread, unassigned ones included: an
 * unassigned conversation is always under takeover, and excluding it would
 * mean post-filtering a page. `unassigned` is the narrower slice when that is
 * what the operator wants.
 */
export const list = query({
  args: {
    workspaceId: v.id("workspaces"),
    tab: v.optional(vConversationTab),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vConversationSummary),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const tab = args.tab ?? "open";
    const result =
      tab === "takeover"
        ? await ctx.db
            .query("conversations")
            .withIndex(
              "by_workspaceId_and_humanTakeover_and_lastMessageAt",
              (q) =>
                q.eq("workspaceId", args.workspaceId).eq("humanTakeover", true),
            )
            .order("desc")
            .paginate({ numItems: limit, cursor: args.cursor ?? null })
        : await ctx.db
            .query("conversations")
            .withIndex("by_workspaceId_and_state_and_lastMessageAt", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("state", tab),
            )
            .order("desc")
            .paginate({ numItems: limit, cursor: args.cursor ?? null });
    const items: ConversationSummary[] = [];
    for (const conversation of result.page) {
      items.push(await summarize(ctx, conversation));
    }
    return {
      items,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * One thread's record, with its lead and campaign resolved so the detail
 * screen needs a single round trip.
 *
 * The campaign is the one FROZEN on the conversation at association; a
 * conversation that has none yet (or one staged by the P10 seam) falls back
 * to the lead's current campaign so the header still renders. The frozen
 * value always wins — that is the point of freezing it.
 */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
  },
  returns: v.object({
    conversation: vConversationDoc,
    prospect: v.union(vConversationProspectRef, v.null()),
    campaign: v.union(vConversationCampaignRef, v.null()),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    const prospectRow =
      conversation.prospectId === undefined
        ? null
        : await ctx.db.get("prospects", conversation.prospectId);
    const prospect =
      prospectRow === null || prospectRow.workspaceId !== args.workspaceId
        ? null
        : prospectRow;
    const campaignId = conversation.campaignId ?? prospect?.campaignId;
    const campaignRow =
      campaignId === undefined
        ? null
        : await ctx.db.get("campaigns", campaignId);
    const campaign =
      campaignRow === null || campaignRow.workspaceId !== args.workspaceId
        ? null
        : campaignRow;
    return {
      conversation,
      prospect:
        prospect === null
          ? null
          : {
              prospectId: prospect._id,
              companyName: prospect.companyName,
              salesStage: prospect.salesStage,
            },
      campaign:
        campaign === null
          ? null
          : {
              campaignId: campaign._id,
              title: campaign.title,
              status: campaign.status,
            },
    };
  },
});

/**
 * The merged thread timeline, newest first — §5's "Authorize message
 * component access", made callable.
 *
 * Inbound bodies come from the AgentMail component (the owner of inbound
 * message storage) and are selected by the conversation's OWN
 * `providerThreadRef`, then filtered to its own `inboxRef`: the component's
 * `by_thread` index is global and AgentMail thread ids are per-inbox, so the
 * inbox filter is what keeps a colliding thread id in another inbox out of
 * this workspace's feed.
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
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vThreadEntry),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
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
