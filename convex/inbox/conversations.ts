/** The inbox list, the per-lead list, one conversation and the tab counts. */
import { query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import {
  boundedLimit,
  domainError,
  MAX_LIST_LIMIT,
  vConversationTab,
} from "../lib/validators";
import {
  getConversationInWorkspace,
  vConversationDoc,
} from "../outreach/draftsModel";
import {
  summarize,
  vConversationAgentRef,
  vConversationProspectRef,
  vConversationSummary,
} from "./conversationsModel";
import type { ConversationSummary } from "./conversationsModel";
import { v } from "convex/values";

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
 * One thread's record, with its lead and agent resolved so the detail screen
 * needs a single round trip.
 *
 * The agent is the one FROZEN on the conversation at association; a
 * conversation that has none yet falls back to the lead's current agent so
 * the header still renders. The frozen value always wins — that is the point
 * of freezing it.
 */
export const get = query({
  args: {
    workspaceId: v.id("workspaces"),
    conversationId: v.id("conversations"),
  },
  returns: v.object({
    conversation: vConversationDoc,
    prospect: v.union(vConversationProspectRef, v.null()),
    agent: v.union(vConversationAgentRef, v.null()),
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
    const agentId = conversation.agentId ?? prospect?.agentId;
    const agentRow =
      agentId === undefined ? null : await ctx.db.get("agents", agentId);
    const agent =
      agentRow === null || agentRow.workspaceId !== args.workspaceId
        ? null
        : agentRow;
    return {
      conversation,
      prospect:
        prospect === null
          ? null
          : {
              prospectId: prospect._id,
              ...(prospect.companyName === undefined
                ? {}
                : { companyName: prospect.companyName }),
              stage: prospect.stage,
            },
      agent:
        agent === null
          ? null
          : { agentId: agent._id, name: agent.name, mode: agent.mode },
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
