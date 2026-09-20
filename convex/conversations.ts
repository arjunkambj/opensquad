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
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  getActiveMembership,
  requireWorkspaceEditor,
  requireWorkspaceMember,
} from "./lib/auth";
import type { AuthCtx } from "./lib/auth";
import {
  boundedLimit,
  boundedString,
  CONVERSATION_NOTE_BODY_MAX_LENGTH,
  domainError,
  invalid,
  MAX_LIST_LIMIT,
  normalizeEmailAddress,
  PROVIDER_REF_MAX_LENGTH,
  THREAD_BODY_MAX_LENGTH,
  vCampaignStatus,
  vConversationState,
  vConversationTab,
  vReplyDisposition,
  vSalesStage,
  vTakeoverReason,
} from "./lib/validators";
import type { ConversationNoteKind } from "./lib/validators";
import { getConversationInWorkspace, vConversationDoc } from "./drafts";
import { sendResultCode, vSendResultCode } from "./sending";
import { matchSuppression } from "./suppressions";
import { conversationNoteFields } from "./schema";

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
    const email = prospect?.contact?.email;
    if (
      prospect !== null &&
      prospect.workspaceId === conversation.workspaceId &&
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
 * The `takeover` tab is every frozen thread — unassigned ones, which are
 * frozen by construction, and closed-but-frozen ones. Both are included
 * because excluding either would mean post-filtering a page, and only
 * `by_workspaceId_and_humanTakeover_and_lastMessageAt` carries the ordering
 * column this tab pages by. `unassigned` and `closed` are the narrower slices
 * when that is what the operator wants.
 *
 * It is therefore a SUPERSET of `attentionCounts.openTakeover`, which counts
 * open threads under takeover only. That count is named for what it measures
 * precisely so it is not wired up as this tab's badge.
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
 * A lead's threads, newest first — the lead detail's conversation tab and the
 * booking proposal flow's "which thread does this draft go on" pick both read
 * it. `by_prospectId` is an exact range, so no page is ever post-filtered. A
 * foreign or missing prospect is NOT_FOUND rather than an empty list —
 * existence must not leak across a workspace boundary.
 */
export const listForProspect = query({
  args: {
    workspaceId: v.id("workspaces"),
    prospectId: v.id("prospects"),
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
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("conversations")
      .withIndex("by_prospectId", (q) => q.eq("prospectId", args.prospectId))
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

/**
 * The bounded attention counts the sidebar Inbox badge and the `/overview`
 * attention block both read.
 *
 * Unassigned mail is its own count here rather than being folded into any
 * other. ONE call serves both surfaces; two numbers for one thing would be a
 * defect.
 *
 * Both buckets are exact ranges on
 * `by_workspaceId_and_state_and_humanTakeover`, and they are disjoint by
 * construction: every unassigned thread is also under takeover, so summing
 * the plain takeover index would double-count. Scoping the second bucket to
 * `state: "open"` removes the overlap and also drops closed-but-frozen
 * threads, which are not attention. Neither range post-filters a truncated
 * page — that is the whole reason the third index exists.
 *
 * THE SECOND BUCKET IS NOT THE `takeover` TAB, AND IT IS NAMED SO IT CANNOT
 * BE MISTAKEN FOR IT. `list({tab: "takeover"})` ranges over
 * `by_workspaceId_and_humanTakeover_and_lastMessageAt` and returns EVERY
 * frozen thread — unassigned ones, which are frozen by construction, and
 * closed-but-frozen ones — because that index carries `lastMessageAt` and the
 * tab must page in inbox order without post-filtering. This count is
 * `openTakeover`: open threads under takeover, which is the attention
 * definition and a strict subset of the tab. A UI that renders `openTakeover`
 * as the tab's badge would show a smaller number above a longer list, so the
 * field says which of the two it is. (Two numbers for one thing is a defect
 * — these are two different things.)
 *
 * Counts are capped at `MAX_LIST_LIMIT` and paired with `hasMore` so the UI
 * renders "50+". Architecture §5 forbids an exact unlimited counter.
 */
export const attentionCounts = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    unassigned: v.number(),
    unassignedHasMore: v.boolean(),
    /** OPEN threads under takeover — not the `takeover` tab's row count. */
    openTakeover: v.number(),
    openTakeoverHasMore: v.boolean(),
    needsAttention: v.number(),
    needsAttentionHasMore: v.boolean(),
    bound: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const unassignedRows = await ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_state_and_humanTakeover", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("state", "unassigned"),
      )
      .take(MAX_LIST_LIMIT + 1);
    const takeoverRows = await ctx.db
      .query("conversations")
      .withIndex("by_workspaceId_and_state_and_humanTakeover", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("state", "open")
          .eq("humanTakeover", true),
      )
      .take(MAX_LIST_LIMIT + 1);

    const unassigned = Math.min(unassignedRows.length, MAX_LIST_LIMIT);
    const unassignedHasMore = unassignedRows.length > MAX_LIST_LIMIT;
    const openTakeover = Math.min(takeoverRows.length, MAX_LIST_LIMIT);
    const openTakeoverHasMore = takeoverRows.length > MAX_LIST_LIMIT;
    const total = unassigned + openTakeover;
    return {
      unassigned,
      unassignedHasMore,
      openTakeover,
      openTakeoverHasMore,
      needsAttention: Math.min(total, MAX_LIST_LIMIT),
      needsAttentionHasMore:
        unassignedHasMore || openTakeoverHasMore || total > MAX_LIST_LIMIT,
      bound: MAX_LIST_LIMIT,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Internal notes                                                      */
/* ------------------------------------------------------------------ */

export const vConversationNoteDoc = v.object({
  _id: v.id("conversationNotes"),
  _creationTime: v.number(),
  ...conversationNoteFields,
});

/**
 * Append one note. `system` rows are the thread's lifecycle trail; `note`
 * rows are human annotations.
 *
 * Notes deliberately do NOT advance `contextVersion`: architecture §8 limits
 * bumps to inbound replies, takeover/assignment/closure and explicit context
 * changes, and a private annotation must not invalidate every live approval
 * on the thread. A note can never resolve a business approval; there is no
 * path from this table to approval state.
 */
export async function recordConversationNote(
  ctx: MutationCtx,
  args: {
    conversation: Doc<"conversations">;
    kind: ConversationNoteKind;
    actor: string;
    body: string;
  },
): Promise<Doc<"conversationNotes">> {
  const body = boundedString(args.body, "body", {
    min: 1,
    max: CONVERSATION_NOTE_BODY_MAX_LENGTH,
  });
  const noteId = await ctx.db.insert("conversationNotes", {
    workspaceId: args.conversation.workspaceId,
    conversationId: args.conversation._id,
    kind: args.kind,
    actor: boundedString(args.actor, "actor", { min: 1, max: 300 }),
    body,
    createdAt: Date.now(),
  });
  const note = await ctx.db.get("conversationNotes", noteId);
  if (note === null) {
    throw domainError("NOT_FOUND", "conversation note not found");
  }
  return note;
}

/** Internal notes on one thread, newest first, cursor-paginated. */
export const listNotes = query({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vConversationNoteDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("conversationNotes")
      .withIndex("by_conversationId_and_createdAt", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/** Add a human note to a thread. Never advances the conversation version. */
export const addNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    body: v.string(),
  },
  returns: vConversationNoteDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    return await recordConversationNote(ctx, {
      conversation,
      kind: "note",
      actor: identityKey,
      body: args.body,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Ownership, takeover and lifecycle                                   */
/* ------------------------------------------------------------------ */

/**
 * The optimistic-concurrency check every versioned mutation shares. It runs
 * AFTER the target-state check, so a retried request that already committed
 * returns the doc rather than a spurious CONFLICT.
 */
function assertContextVersion(
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
async function advanceContext(
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
  await ctx.runMutation(internal.drafts.retireConversationWork, {
    conversationId: conversation._id,
    reason,
  });
  const updated = await ctx.db.get("conversations", conversation._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "conversation not found");
  }
  return updated;
}

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
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
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
 * The assignee must resolve to an active membership before it is stored —
 * the same rule `prospects.ownerIdentityKey` carries. An identity that is not
 * an active member is a bad argument, not a hidden row, so it is INVALID
 * rather than NOT_FOUND.
 */
export const assignOwner = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    assigneeIdentityKey: v.optional(v.string()),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    const next =
      args.assigneeIdentityKey === undefined
        ? undefined
        : boundedString(args.assigneeIdentityKey, "assigneeIdentityKey", {
            min: 1,
            max: 300,
          });
    if (next !== undefined) {
      const membership = await getActiveMembership(
        ctx,
        args.workspaceId,
        next,
      );
      if (membership === null) {
        throw invalid("assignee must be an active member of this workspace");
      }
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
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
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
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
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
 * `contextVersion`: `unreadCount` is a single shared workspace counter, and
 * having read a thread is not a fact that invalidates a draft. Bumping the
 * version here would make every open approval stale each time someone opened
 * the inbox.
 */
export const markRead = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
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

/* ------------------------------------------------------------------ */
/* The unassigned queue (internal — inbound ingest only)               */
/* ------------------------------------------------------------------ */

/**
 * Find or create the workspace-scoped unassigned conversation for a verified
 * inbound message that matched no existing thread (architecture §8 step 4,
 * integrations.md §G3 "unmatched known-inbox messages enter that workspace's
 * unassigned queue under human takeover").
 *
 * The inbox is already known to belong to this workspace — the callback
 * resolved it from the saved assignment, never from a body or a display
 * address — so the row has a legitimate owner. What it does NOT have is a
 * lead: no prospect is guessed, no campaign is guessed, and nothing about the
 * sender selects one. `associateProspect` is the only way a lead is attached,
 * and it is human-only.
 *
 * The row is created with `state: "unassigned"` and `humanTakeover: true`, so
 * the reply-automation gate refuses it three separate ways. Its lifecycle is
 * recorded on the conversation row and in `conversationNotes`.
 *
 * IT NEVER THROWS for a condition a retry cannot fix. This runs inside the
 * ingest transaction, and a throw there leaves the receipt `pending` for the
 * drain to retry forever. An unrecoverable condition is returned as a reason
 * so the receipt can record it as `failed` and an operator can see it.
 */
export const ensureUnassignedConversation = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    inboxRef: v.string(),
    providerThreadRef: v.string(),
    /** Ingest time of the message, never the provider's own timestamp. */
    at: v.number(),
    messageRef: v.string(),
    fromAddress: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      created: v.boolean(),
      conversation: vConversationDoc,
    }),
    v.object({ ok: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      return { ok: false as const, reason: "workspace not found" };
    }
    // Re-check the claim inside this transaction. `.collect()` plus a
    // workspace filter, not `.unique()`: the pair's uniqueness is
    // transactional and the index is global, so a foreign row must neither
    // block the claim nor be adopted. A concurrent claim is resolved by
    // returning the winner, never by throwing CONFLICT — a throw here would
    // lose the event.
    const claimed = (
      await ctx.db
        .query("conversations")
        .withIndex("by_inboxRef_and_providerThreadRef", (q) =>
          q
            .eq("inboxRef", args.inboxRef)
            .eq("providerThreadRef", args.providerThreadRef),
        )
        .collect()
    )
      .filter((row) => row.workspaceId === args.workspaceId)
      .sort((left, right) => left._creationTime - right._creationTime);
    if (claimed.length > 0) {
      return { ok: true as const, created: false, conversation: claimed[0] };
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      workspaceId: args.workspaceId,
      inboxRef: args.inboxRef,
      state: "unassigned",
      humanTakeover: true,
      takeoverReason: "unassigned_inbound",
      takeoverBy: "system",
      takeoverAt: now,
      contextVersion: 1,
      unreadCount: 1,
      createdAt: now,
      updatedAt: now,
      providerThreadRef: args.providerThreadRef,
      // The inbound facts are written at insert so the very first message is
      // already applied. `drafts.applyInboundContext` then no-ops for it
      // (`lastInboundMessageRef` already matches) and the row opens at
      // contextVersion 1 rather than 2 — while a SECOND message on the same
      // unassigned thread advances it normally.
      lastInboundMessageRef: args.messageRef,
      lastInboundAt: args.at,
      lastMessageAt: args.at,
      ...(args.fromAddress !== undefined
        ? { lastInboundFrom: args.fromAddress }
        : {}),
    });
    const conversation = await ctx.db.get("conversations", conversationId);
    if (conversation === null) {
      return { ok: false as const, reason: "conversation not found after insert" };
    }
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: "system",
      body: "Unmatched reply held for review. Link a lead and campaign to work it; automation stays frozen until an explicit resume.",
    });
    return { ok: true as const, created: true, conversation };
  },
});

/* ------------------------------------------------------------------ */
/* Association and resume                                              */
/* ------------------------------------------------------------------ */

/**
 * Why a resume refused to re-arm automation. These are returned, not thrown:
 * the operator needs to see which gate is closed, and every one of them
 * leaves takeover ON, so a refusal is always safe.
 *
 * Names line up with `SEND_BLOCK_CODES` wherever the same gate exists, so the
 * inbox and the send preflight speak one vocabulary.
 */
export const RESUME_BLOCK_CODES = [
  "association_missing",
  "campaign_mismatch",
  "campaign_inactive",
  "workspace_paused",
  "inbox_unassigned",
  "inbox_mismatch",
  "recipient_unknown",
  "sender_unverified",
  "sender_contact_mismatch",
  "suppressed_email",
  "suppressed_domain",
] as const;

export type ResumeBlockCode = (typeof RESUME_BLOCK_CODES)[number];

/**
 * Declared as a const rather than inline so the handler can be annotated with
 * its own return type — the same reason `drafts.retireConversationWork`
 * returns `v.null()` and every handler in `inbox.ts` states its type.
 */
const vResumeResult = v.object({
  conversation: vConversationDoc,
  /** Whether reply automation was started for the latest inbound message. */
  dispatched: v.boolean(),
  /** A `RESUME_BLOCK_CODES` member when a policy check refused. */
  blockedBy: v.optional(v.string()),
  /** Why no reply automation started, when the resume itself succeeded. */
  replyNote: v.optional(v.string()),
});

export type ResumeResult = typeof vResumeResult.type;

/**
 * Link an unassigned thread to a lead and campaign already in this workspace
 * (§5 `associateProspect`).
 *
 * Association is HUMAN-ONLY: email content can never choose a lead, and this
 * mutation takes ids from an authenticated editor only. It validates that the
 * lead is in this workspace and that it belongs to the named campaign — a
 * caller asserting which campaign it believes it is binding turns a
 * disagreement into a CONFLICT instead of a silent bind.
 *
 * It DISPATCHES NOTHING. §8: "advance context, set state to open and keep
 * takeover enabled." No draft, no send — re-arming automation is the
 * separate, checked act of `resume` (V16 step 3).
 *
 * `requestId` is accepted because §5 names it, and it is bounded; association
 * needs no receipt store because it is once-per-conversation by construction
 * (only an `unassigned` conversation can be associated, and the first
 * association makes it `open`). A retry of the same association returns the
 * doc unchanged.
 */
export const associateProspect = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    prospectId: v.id("prospects"),
    campaignId: v.id("campaigns"),
    requestId: v.string(),
  },
  returns: vConversationDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    // Idempotent retry, checked before the version so a replayed request
    // returns the doc rather than a spurious CONFLICT.
    if (
      conversation.prospectId === args.prospectId &&
      conversation.campaignId === args.campaignId
    ) {
      return conversation;
    }
    if (conversation.state !== "unassigned") {
      throw domainError(
        "CONFLICT",
        "association accepts only an unassigned conversation",
      );
    }
    assertContextVersion(conversation, args.expectedContextVersion);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    // The same message for a missing lead and one in another workspace —
    // never reveal another workspace's rows.
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "prospect not found");
    }
    const campaign = await ctx.db.get("campaigns", args.campaignId);
    if (campaign === null || campaign.workspaceId !== args.workspaceId) {
      throw domainError("NOT_FOUND", "campaign not found");
    }
    if (prospect.campaignId !== args.campaignId) {
      throw domainError(
        "CONFLICT",
        "prospect belongs to a different campaign",
      );
    }
    const updated = await advanceContext(
      ctx,
      conversation,
      {
        prospectId: args.prospectId,
        campaignId: args.campaignId,
        state: "open",
        // Deliberately kept: association proves who the thread is about, not
        // that automation may speak for us again.
        humanTakeover: true,
        takeoverReason: "awaiting_resume",
        takeoverBy: identityKey,
        takeoverAt: Date.now(),
      },
      "the conversation was associated with a lead",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body: `Associated with ${prospect.companyName} on campaign "${campaign.title}". Takeover stays on until resume.`,
    });
    // A reply that arrived while the thread was still unassigned is a reply
    // fact once the lead is named — stamp `lastReplyAt`/`replied` from the
    // recorded inbound now (P19). Keyed on the message ref, so re-running it
    // later is a no-op.
    if (
      updated.lastInboundMessageRef !== undefined &&
      updated.lastInboundAt !== undefined
    ) {
      await ctx.runMutation(internal.prospects.markReplied, {
        conversationId: updated._id,
        messageRef: updated.lastInboundMessageRef,
        at: updated.lastInboundAt,
      });
    }
    return updated;
  },
});

/**
 * Re-arm automation on a frozen thread — the ONLY path that clears
 * `humanTakeover` (V16 step 3).
 *
 * Architecture §8 requires an explicit resume to validate the association,
 * the verified sender/contact match, the campaign and the current policy.
 * Each of those is re-run here, in order, and a failure RETURNS its block
 * code with takeover left on rather than throwing — the operator needs to see
 * which gate is closed, and a refusal is always the safe outcome.
 *
 * The verified sender/contact match is what stops a stranger's reply on an
 * associated thread from re-arming outreach to that lead: the stored
 * `lastInboundFrom` must match the address we actually mail. It can only
 * refuse, never grant — the send recipient is always resolved by the
 * application, never from the inbound payload.
 *
 * Once every check passes the thread is re-armed. Drafting a reply to the
 * latest inbound message is not yet wired up.
 */
export const resume = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
    expectedContextVersion: v.number(),
    requestId: v.string(),
  },
  returns: vResumeResult,
  handler: async (ctx, args): Promise<ResumeResult> => {
    const { identityKey, workspace } = await requireWorkspaceEditor(
      ctx,
      args.workspaceId,
    );
    boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    const conversation = await getConversationInWorkspace(
      ctx,
      args.workspaceId,
      args.conversationId,
    );
    // Idempotent retry: an already-resumed thread returns rather than
    // CONFLICTing on a version that the first call advanced.
    if (!conversation.humanTakeover) {
      return { conversation, dispatched: false };
    }
    if (conversation.state !== "open") {
      throw domainError(
        "CONFLICT",
        `conversation is ${conversation.state}; only an open conversation can resume`,
      );
    }
    assertContextVersion(conversation, args.expectedContextVersion);

    const blocked = (
      code: ResumeBlockCode,
    ): {
      conversation: Doc<"conversations">;
      dispatched: boolean;
      blockedBy: string;
    } => ({ conversation, dispatched: false, blockedBy: code });

    if (
      conversation.prospectId === undefined ||
      conversation.campaignId === undefined
    ) {
      return blocked("association_missing");
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.workspaceId !== args.workspaceId) {
      return blocked("association_missing");
    }
    const campaign = await ctx.db.get("campaigns", conversation.campaignId);
    if (campaign === null || campaign.workspaceId !== args.workspaceId) {
      return blocked("association_missing");
    }
    if (prospect.campaignId !== conversation.campaignId) {
      return blocked("campaign_mismatch");
    }
    if (campaign.status !== "active") {
      return blocked("campaign_inactive");
    }
    if (workspace.automationState !== "active") {
      return blocked("workspace_paused");
    }
    if (workspace.inboxRef === undefined) {
      return blocked("inbox_unassigned");
    }
    if (workspace.inboxRef !== conversation.inboxRef) {
      return blocked("inbox_mismatch");
    }

    // The address we would actually mail, resolved by the application: the
    // lead's contact, else the address the last revision was authorized
    // against. Never the inbound `from`.
    const { recipient, latestDraft } = await resolveOutboundRecipient(
      ctx,
      conversation,
    );
    if (recipient === null) {
      return blocked("recipient_unknown");
    }

    if (conversation.lastInboundMessageRef !== undefined) {
      if (conversation.lastInboundFrom === undefined) {
        // Mail arrived but its sender never parsed as a single address, so
        // there is nothing to verify against. Refuse rather than guess.
        return blocked("sender_unverified");
      }
      const matchesContact = conversation.lastInboundFrom === recipient;
      const matchesLastDraft =
        latestDraft !== null &&
        conversation.lastInboundFrom === latestDraft.normalizedRecipient;
      if (!matchesContact && !matchesLastDraft) {
        return blocked("sender_contact_mismatch");
      }
    }

    const suppression = await matchSuppression(
      ctx,
      args.workspaceId,
      recipient,
    );
    if (suppression !== null) {
      return blocked(
        suppression.matchedBy === "domain"
          ? "suppressed_domain"
          : "suppressed_email",
      );
    }

    const updated = await advanceContext(
      ctx,
      conversation,
      {
        humanTakeover: false,
        takeoverReason: undefined,
        takeoverBy: undefined,
        takeoverAt: undefined,
      },
      "an operator resumed automation on the conversation",
    );
    await recordConversationNote(ctx, {
      conversation,
      kind: "system",
      actor: identityKey,
      body: "Automation resumed; association, campaign, sender and policy checks passed.",
    });
    // Automation is re-armed, but nothing drafts a reply for the latest
    // inbound message yet — the thread stays in its needs-a-human state.
    // AI classify/draft: reimplemented via Convex AI Gateway (see plan)
    return { conversation: updated, dispatched: false };
  },
});
