/** The inbox list, the per-lead list, one conversation and the tab counts. */
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { paged } from "../lib/pagination";
import {
  boundedLimit,
  domainError,
  MAX_LIST_LIMIT,
} from "../lib/validators";
import {
  getConversationInOrg,
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
 * A lead's threads, newest first — the lead detail's conversation tab and the
 * booking proposal flow's "which thread does this draft go on" pick both read
 * it. `by_prospectId` is an exact range, so no page is ever post-filtered. A
 * foreign or missing prospect is NOT_FOUND rather than an empty list —
 * existence must not leak across an org boundary.
 */
export const listForProspect = query({
  args: {
    orgId: v.id("orgs"),
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
    await requireOrgMember(ctx, args.orgId);
    const prospect = await ctx.db.get("prospects", args.prospectId);
    if (prospect === null || prospect.orgId !== args.orgId) {
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
    return paged(result, items);
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
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
  },
  returns: v.object({
    conversation: vConversationDoc,
    prospect: v.union(vConversationProspectRef, v.null()),
    agent: v.union(vConversationAgentRef, v.null()),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    const prospectRow =
      conversation.prospectId === undefined
        ? null
        : await ctx.db.get("prospects", conversation.prospectId);
    const prospect =
      prospectRow === null || prospectRow.orgId !== args.orgId
        ? null
        : prospectRow;
    const agentRow =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const agent =
      agentRow === null || agentRow.orgId !== args.orgId
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
 * The bounded attention counts the sidebar Inbox badge reads.
 *
 * Unassigned mail is its own count rather than folded into takeover: every
 * unassigned thread is also under takeover, so summing one plain takeover
 * range would double-count. Scoping the second bucket to `state: "open"`
 * removes the overlap and drops closed-but-frozen threads, which are not
 * attention. `openTakeover` is therefore a strict subset of the takeover
 * pill's rows, and is named so it cannot be mistaken for that count.
 *
 * Counts are capped at `MAX_LIST_LIMIT` and paired with `hasMore` so the UI
 * renders "50+".
 */
export const attentionCounts = query({
  args: { orgId: v.id("orgs") },
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
    await requireOrgMember(ctx, args.orgId);
    const unassignedRows = await ctx.db
      .query("conversations")
      .withIndex("by_orgId_and_state_and_humanTakeover", (q) =>
        q.eq("orgId", args.orgId).eq("state", "unassigned"),
      )
      .take(MAX_LIST_LIMIT + 1);
    const takeoverRows = await ctx.db
      .query("conversations")
      .withIndex("by_orgId_and_state_and_humanTakeover", (q) =>
        q
          .eq("orgId", args.orgId)
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
