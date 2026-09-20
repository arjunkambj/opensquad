/**
 * The numbers three screens ask for: is the agent still finding leads
 * (Contacts), how many did each signal generate (Agent), and where do the
 * leads sit (Dashboard).
 *
 * Every count is an EXACT index range with a stated bound, and every one
 * returns `hasMore` beside it: Convex has no count API, so a count is a
 * bounded read, and a screen that renders "100+" is telling the truth while
 * a screen that renders a silently truncated 100 is not.
 *
 * Read-only, member-guarded, and free. No provider is named here — a signal
 * is the user's own saved search, and that is all these queries say.
 */
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { MAX_SEARCH_PAGE } from "../integrations/enrich/search";
import { requireWorkspaceMember } from "../lib/auth";
import {
  LEAD_SCORE_MAX,
  LEAD_SCORE_MIN,
  LEAD_STAGES,
  vAgentMode,
  vAgentStatus,
  vSignalKind,
} from "../lib/validators";
import type { LeadStage } from "../lib/validators";
import { v } from "convex/values";

/**
 * How far any one count reads. A trial workspace's whole table is smaller
 * than this, so in practice `hasMore` is false everywhere — the bound is what
 * keeps a query honest if that stops being true.
 */
export const LEAD_COUNT_BOUND = 100;

const vCount = v.object({ count: v.number(), hasMore: v.boolean() });

type Count = { count: number; hasMore: boolean };

const vStageCounts = v.object({
  found: vCount,
  researched: vCount,
  queued: vCount,
  contacted: vCount,
  replied: vCount,
  interested: vCount,
  meeting_proposed: vCount,
  meeting_booked: vCount,
  closed_lost: vCount,
  rejected: vCount,
  needs_attention: vCount,
});

/**
 * What the agent is doing right now — the state Contacts renders as "Finding
 * your first leads…" while the first run is still in progress.
 *
 * `running` is the run lease being LIVE, not merely present: an expired lease
 * belongs to an action that is already dead, and telling the user it is still
 * working would be the one piece of fiction on the screen.
 */
export const runState = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(
    v.null(),
    v.object({
      agentId: v.id("agents"),
      status: vAgentStatus,
      mode: vAgentMode,
      running: v.boolean(),
      startedAt: v.optional(v.number()),
      lastRunAt: v.optional(v.number()),
      nextRunAt: v.optional(v.number()),
      /** Found, not yet researched — the "Not researched yet" rows. */
      found: vCount,
      researched: vCount,
      needsAttention: vCount,
    }),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    if (agent === null) {
      return null;
    }
    const now = Date.now();
    return {
      agentId: agent._id,
      status: agent.status,
      mode: agent.mode,
      running: agent.run !== undefined && agent.run.leaseUntil > now,
      ...(agent.run !== undefined ? { startedAt: agent.run.startedAt } : {}),
      ...(agent.lastRunAt !== undefined ? { lastRunAt: agent.lastRunAt } : {}),
      ...(agent.nextRunAt !== undefined ? { nextRunAt: agent.nextRunAt } : {}),
      found: await countStage(ctx, agent._id, "found"),
      researched: await countScored(ctx, args.workspaceId, LEAD_SCORE_MIN),
      needsAttention: await countStage(ctx, agent._id, "needs_attention"),
    };
  },
});

/**
 * Leads generated per signal — the Agent page's table, from the counter the
 * run itself records (`strategies.leadsFound`), so a weak signal is visible
 * and can be switched off.
 *
 * `exhausted` is the honest reason a signal stopped growing: its free pages
 * are used up, which is a different thing from a signal that found nobody.
 */
export const byStrategy = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.array(
    v.object({
      strategyId: v.id("strategies"),
      title: v.string(),
      signalKind: vSignalKind,
      rationale: v.string(),
      enabled: v.boolean(),
      leadsFound: v.number(),
      matchCount: v.number(),
      exhausted: v.boolean(),
      lastRunAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const strategies = await ctx.db
      .query("strategies")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .take(LEAD_COUNT_BOUND);
    return strategies
      .sort((a, b) => b.leadsFound - a.leadsFound || a.createdAt - b.createdAt)
      .map((strategy) => ({
        strategyId: strategy._id,
        title: strategy.title,
        signalKind: strategy.signalKind,
        rationale: strategy.rationale,
        enabled: strategy.enabled,
        leadsFound: strategy.leadsFound,
        matchCount: strategy.matchCount,
        exhausted: strategy.nextPage > MAX_SEARCH_PAGE,
        ...(strategy.lastRunAt !== undefined
          ? { lastRunAt: strategy.lastRunAt }
          : {}),
      }));
  },
});

/**
 * Where the workspace's leads sit, and how they scored — the Dashboard's
 * funnel. One bounded range per stage and per flame score; nothing is
 * post-filtered, so every number is an index range and not a scan.
 */
export const funnel = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    bound: v.number(),
    stages: vStageCounts,
    /** Index 0 is score 1. A researched lead is in exactly one of them. */
    scores: v.array(vCount),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .first();
    const stages = {} as Record<LeadStage, Count>;
    for (const stage of LEAD_STAGES) {
      stages[stage] =
        agent === null
          ? { count: 0, hasMore: false }
          : await countStage(ctx, agent._id, stage);
    }
    const scores: Count[] = [];
    for (let score = LEAD_SCORE_MIN; score <= LEAD_SCORE_MAX; score += 1) {
      scores.push(await countScored(ctx, args.workspaceId, score, score));
    }
    return { bound: LEAD_COUNT_BOUND, stages, scores };
  },
});

async function countStage(
  ctx: QueryCtx,
  agentId: Id<"agents">,
  stage: LeadStage,
): Promise<Count> {
  const rows = await ctx.db
    .query("prospects")
    .withIndex("by_agentId_and_stage", (q) =>
      q.eq("agentId", agentId).eq("stage", stage),
    )
    .take(LEAD_COUNT_BOUND + 1);
  return {
    count: Math.min(rows.length, LEAD_COUNT_BOUND),
    hasMore: rows.length > LEAD_COUNT_BOUND,
  };
}

/**
 * Researched leads by flame score, over the denormalised `scoreKey` — the
 * index that exists precisely because Convex cannot reach `research.aiScore`
 * inside its union member.
 */
async function countScored(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  min: number,
  max?: number,
): Promise<Count> {
  const rows = await ctx.db
    .query("prospects")
    .withIndex("by_workspaceId_and_scoreKey", (q) => {
      const scoped = q.eq("workspaceId", workspaceId).gte("scoreKey", min);
      return max === undefined ? scoped : scoped.lte("scoreKey", max);
    })
    .take(LEAD_COUNT_BOUND + 1);
  return {
    count: Math.min(rows.length, LEAD_COUNT_BOUND),
    hasMore: rows.length > LEAD_COUNT_BOUND,
  };
}
