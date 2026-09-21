/**
 * The two panels at the foot of reference 20: the window's hottest leads, and
 * the people who replied in it.
 *
 * Both are lists rather than counts, and both print only what their rows
 * carry — no invented name, no invented preview. `model.ts` explains the
 * bounds; `leadReads.ts` and `outcomeReads.ts` name the rows.
 */
import { query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireOrgMember } from "../lib/auth";
import {
  boundedLimit,
  vInboxConnection,
  vReplyDisposition,
} from "../lib/validators";
import type { ReplyDisposition } from "../lib/validators";
import { loadHotLeads } from "./leadReads";
import {
  HOT_LEAD_SCORE,
  assertRange,
  leadDisplayName,
  vRange,
} from "./model";
import { loadRepliedConversations } from "./outcomeReads";
import { v } from "convex/values";

/**
 * "Latest hot leads" — leads that were SCORED 3 inside the window, most
 * recently scored first. Person fields are optional on a sourced lead and are
 * omitted rather than filled in: the panel prints what the row says and
 * nothing else.
 *
 * Each row carries `scoredAt`, which is the instant the window was applied to
 * (`research.researchedAt`) — not the lead's creation, which can be months
 * earlier and would read as a different list from the one this panel is.
 */
export const latestHotLeads = query({
  args: { ...vRange, limit: v.optional(v.number()) },
  returns: v.object({
    items: v.array(
      v.object({
        prospectId: v.id("prospects"),
        score: v.number(),
        /** When research scored it — the timestamp the window bounds. */
        scoredAt: v.number(),
        name: v.optional(v.string()),
        jobTitle: v.optional(v.string()),
        companyName: v.optional(v.string()),
      }),
    ),
    /** More scored-3 leads in this window than the panel lists. */
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const range = assertRange(args.from, args.to);
    const limit = boundedLimit(args.limit);
    const { rows } = await loadHotLeads(ctx, args.orgId, range);
    return {
      items: rows.slice(0, limit).map((lead) => {
        const name = leadDisplayName(lead);
        return {
          prospectId: lead._id,
          score: HOT_LEAD_SCORE,
          // `loadHotLeads` only returns researched leads, so the union member
          // carrying `researchedAt` is the one this row is in.
          scoredAt:
            lead.research.status === "researched"
              ? lead.research.researchedAt
              : lead.createdAt,
          ...(name !== null ? { name } : {}),
          ...(lead.jobTitle !== undefined ? { jobTitle: lead.jobTitle } : {}),
          ...(lead.companyName !== undefined
            ? { companyName: lead.companyName }
            : {}),
        };
      }),
      hasMore: rows.length > limit,
    };
  },
});

/**
 * "Latest replies" — threads whose most recent inbound message landed inside
 * the window, newest first.
 *
 * There is no message body on a `conversations` row, so there is no preview
 * here: the panel shows who replied, when, and the classification the reply
 * handler recorded, if any. A one-line summary would have to be invented, and
 * an invented summary of someone's email is the one thing this screen must
 * never print.
 *
 * `inboxConnection` travels with the list so the panel can tell "no inbox
 * connected" from "connected and quiet" without a second, owner-only read.
 */
type ReplyItem = {
  conversationId: Id<"conversations">;
  repliedAt: number;
  name?: string;
  companyName?: string;
  fromAddress?: string;
  disposition?: ReplyDisposition;
};

export const latestReplies = query({
  args: { ...vRange, limit: v.optional(v.number()) },
  returns: v.object({
    inboxConnection: vInboxConnection,
    items: v.array(
      v.object({
        conversationId: v.id("conversations"),
        repliedAt: v.number(),
        /** The associated lead, when the thread has one. */
        name: v.optional(v.string()),
        companyName: v.optional(v.string()),
        /** The stored sender of that inbound message, when it parsed as one. */
        fromAddress: v.optional(v.string()),
        disposition: v.optional(vReplyDisposition),
      }),
    ),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { org } = await requireOrgMember(ctx, args.orgId);
    const range = assertRange(args.from, args.to);
    const limit = boundedLimit(args.limit);
    const { rows } = await loadRepliedConversations(ctx, args.orgId, range);

    const items: ReplyItem[] = [];
    for (const conversation of rows.slice(0, limit)) {
      const lead =
        conversation.prospectId === undefined
          ? null
          : await ctx.db.get("prospects", conversation.prospectId);
      const name = lead === null ? null : leadDisplayName(lead);
      items.push({
        conversationId: conversation._id,
        repliedAt: conversation.lastInboundAt ?? conversation.updatedAt,
        ...(name !== null ? { name } : {}),
        ...(lead?.companyName !== undefined
          ? { companyName: lead.companyName }
          : {}),
        ...(conversation.lastInboundFrom !== undefined
          ? { fromAddress: conversation.lastInboundFrom }
          : {}),
        ...(conversation.lastDisposition !== undefined
          ? { disposition: conversation.lastDisposition }
          : {}),
      });
    }
    return {
      inboxConnection: org.inboxConnection,
      items,
      hasMore: rows.length > limit,
    };
  },
});
