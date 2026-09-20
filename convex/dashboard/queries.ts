/**
 * Dashboard reads — reference 20, one query per panel.
 *
 * Read-only aggregates (PLAN §10): every function here is a member-guarded
 * `query` over rows another domain wrote, and the domain owns no mutation.
 * Nothing is derived that the tables do not state — a figure the data cannot
 * answer comes back `null` and the screen says so, rather than a zero that
 * reads as a counted result.
 *
 * `from`/`to` are instants the caller derived in the workspace's own zone;
 * `model.ts` explains the bounds and names the rows behind every number.
 */
import { query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireWorkspaceMember } from "../lib/auth";
import { getWorkspaceAgent } from "../agents/model";
import {
  boundedLimit,
  vAgentMode,
  vInboxConnection,
  vReplyDisposition,
} from "../lib/validators";
import type { ReplyDisposition } from "../lib/validators";
import {
  DASHBOARD_SCAN_BOUND,
  HOT_LEAD_SCORE,
  NONE,
  assertRange,
  bucketByDay,
  countConfirmedMeetings,
  countInterested,
  countPendingApprovals,
  countProposedMeetings,
  leadDisplayName,
  loadAcknowledgedSends,
  loadHotLeads,
  loadLeadsCreated,
  loadRepliedConversations,
  vBounded,
} from "./model";
import { v } from "convex/values";

const vRange = {
  workspaceId: v.id("workspaces"),
  from: v.number(),
  to: v.number(),
};

/**
 * The five figures of the stat row, over one window.
 *
 * `pipeline` is `null` until a deal size is recorded — the screen then offers
 * "Set deal size" rather than a zero or a dash pretending to be a number. It
 * is `atLeast` whenever one of the two counts behind it hit its bound, so a
 * truncated figure is never presented as a total.
 *
 * `meetings` is CONFIRMED bookings only (PLAN §9.5). Proposals come back
 * separately and are a LIVE count, not a windowed one — a proposal has no
 * agreed time to place it in a window.
 */
export const summary = query({
  args: vRange,
  returns: v.object({
    bound: v.number(),
    hotLeads: vBounded,
    /** Distinct people an accepted email reached inside the window. */
    contacted: vBounded,
    /** Accepted emails, follow-ups included — the line under "Contacted". */
    emailsSent: vBounded,
    /** Threads a real reply landed in. */
    conversations: vBounded,
    meetings: vBounded,
    meetingsProposed: vBounded,
    interested: vBounded,
    dealSize: v.union(v.null(), v.number()),
    pipeline: v.union(
      v.null(),
      v.object({ amount: v.number(), atLeast: v.boolean() }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const range = assertRange(args.from, args.to);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);

    const hotLeads = (await loadHotLeads(ctx, args.workspaceId, range)).bounded;
    const sends = await loadAcknowledgedSends(ctx, args.workspaceId, range);
    const replies = await loadRepliedConversations(ctx, args.workspaceId, range);
    const meetings = await countConfirmedMeetings(ctx, args.workspaceId, range);
    const meetingsProposed = await countProposedMeetings(ctx, args.workspaceId);
    const interested = await countInterested(ctx, args.workspaceId, range);

    const dealSize = agent?.dealSize ?? null;
    return {
      bound: DASHBOARD_SCAN_BOUND,
      hotLeads,
      contacted: sends.contacted,
      emailsSent: sends.emails,
      conversations: replies.bounded,
      meetings,
      meetingsProposed,
      interested,
      dealSize,
      pipeline:
        dealSize === null
          ? null
          : {
              amount: dealSize * (interested.count + meetings.count),
              atLeast: interested.hasMore || meetings.hasMore,
            },
    };
  },
});

/**
 * The activity chart's daily series, in the workspace's own days.
 *
 * All three series are real counts of stored rows, so on a workspace that has
 * not sent anything yet `contacted` and `replies` are flat zeros — which is
 * why the chart draws a series only once its rows exist, rather than three
 * lines along the axis.
 */
export const activitySeries = query({
  args: vRange,
  returns: v.object({
    bound: v.number(),
    timezone: v.string(),
    /** One of the series hit the bound; the chart says which rows it counted. */
    truncated: v.boolean(),
    days: v.array(
      v.object({
        dayKey: v.string(),
        leadsCreated: v.number(),
        contacted: v.number(),
        replies: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceMember(ctx, args.workspaceId);
    const range = assertRange(args.from, args.to);

    const leads = await loadLeadsCreated(ctx, args.workspaceId, range);
    const sends = await loadAcknowledgedSends(ctx, args.workspaceId, range);
    const replies = await loadRepliedConversations(ctx, args.workspaceId, range);

    return {
      bound: DASHBOARD_SCAN_BOUND,
      timezone: workspace.timezone,
      truncated:
        leads.bounded.hasMore ||
        sends.emails.hasMore ||
        replies.bounded.hasMore,
      days: bucketByDay(range, workspace.timezone, {
        leadsCreated: leads.createdAt,
        contacted: sends.rows.map((row) => row.updatedAt),
        replies: replies.rows.map((row) => row.lastInboundAt ?? row.updatedAt),
      }),
    };
  },
});

/**
 * "Latest hot leads" — researched leads that scored 3 inside the window,
 * newest first. Person fields are optional on a sourced lead and are omitted
 * rather than filled in: the panel prints what the row says and nothing else.
 */
export const latestHotLeads = query({
  args: { ...vRange, limit: v.optional(v.number()) },
  returns: v.object({
    items: v.array(
      v.object({
        prospectId: v.id("prospects"),
        score: v.number(),
        createdAt: v.number(),
        name: v.optional(v.string()),
        jobTitle: v.optional(v.string()),
        companyName: v.optional(v.string()),
      }),
    ),
    /** More scored-3 leads in this window than the panel lists. */
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const range = assertRange(args.from, args.to);
    const limit = boundedLimit(args.limit);
    const { rows } = await loadHotLeads(ctx, args.workspaceId, range);
    return {
      items: rows.slice(0, limit).map((lead) => {
        const name = leadDisplayName(lead);
        return {
          prospectId: lead._id,
          score: HOT_LEAD_SCORE,
          createdAt: lead.createdAt,
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
    const { workspace } = await requireWorkspaceMember(ctx, args.workspaceId);
    const range = assertRange(args.from, args.to);
    const limit = boundedLimit(args.limit);
    const { rows } = await loadRepliedConversations(ctx, args.workspaceId, range);

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
      inboxConnection: workspace.inboxConnection,
      items,
      hasMore: rows.length > limit,
    };
  },
});

/**
 * The one thing to do next, decided from real state rather than from a step
 * counter: finish setup, connect the inbox, choose how the agent sends,
 * approve the leads waiting, let it send on its own, or nothing at all.
 *
 * Order matters and is not the order of the list above: approving leads is
 * pointless while the agent is not allowed to send, so choosing a sending
 * mode comes first. The copy for each state lives in the component — this
 * returns the state and the numbers behind it.
 */
export const nextStep = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(
    v.object({ kind: v.literal("finish_setup") }),
    v.object({
      kind: v.literal("connect_inbox"),
      inboxConnection: vInboxConnection,
    }),
    v.object({ kind: v.literal("start_sending"), mode: vAgentMode }),
    v.object({ kind: v.literal("approve_leads"), pending: vBounded }),
    v.object({ kind: v.literal("enable_autopilot") }),
    v.object({ kind: v.literal("all_set"), pending: vBounded }),
  ),
  handler: async (ctx, args) => {
    const { workspace } = await requireWorkspaceMember(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
    if (agent === null || agent.status === "draft") {
      return { kind: "finish_setup" as const };
    }
    if (workspace.inboxConnection !== "connected") {
      return {
        kind: "connect_inbox" as const,
        inboxConnection: workspace.inboxConnection,
      };
    }
    if (agent.mode === "paused" || agent.mode === "sourcing_only") {
      return { kind: "start_sending" as const, mode: agent.mode };
    }
    const pending = await countPendingApprovals(ctx, args.workspaceId);
    if (pending.count > 0) {
      return { kind: "approve_leads" as const, pending };
    }
    if (agent.mode === "review") {
      return { kind: "enable_autopilot" as const };
    }
    return { kind: "all_set" as const, pending: NONE };
  },
});
