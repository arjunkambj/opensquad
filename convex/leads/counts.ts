import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { MAX_SEARCH_PAGE } from "../integrations/enrich/search";
import { requireOrgMember } from "../lib/auth";
import {
  LEAD_SCORE_MAX,
  LEAD_SCORE_MIN,
  LEAD_STAGES,
  vAgentMode,
  vAgentStatus,
  vOperationErrorCode,
  vSignalKind,
} from "../lib/validators";
import { COUNT_SCAN_BOUND } from "../lib/limits";
import type { LeadStage } from "../lib/validators";
import { v } from "convex/values";

export const LEAD_COUNT_BOUND = COUNT_SCAN_BOUND;

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

/** Pass a coarse client clock to expire stale leases reactively. Without now, running means only that a lease exists. */
export const runState = query({
  args: { orgId: v.id("orgs"), now: v.optional(v.number()) },
  returns: v.union(
    v.null(),
    v.object({
      agentId: v.id("agents"),
      status: vAgentStatus,
      mode: vAgentMode,
      running: v.boolean(),
      /** When the current lease expires; absent when no run holds one. */
      leaseUntil: v.optional(v.number()),
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
    await requireOrgMember(ctx, args.orgId);
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .first();
    if (agent === null) {
      return null;
    }
    return {
      agentId: agent._id,
      status: agent.status,
      mode: agent.mode,
      running:
        agent.run !== undefined &&
        (args.now === undefined || agent.run.leaseUntil > args.now),
      ...(agent.run !== undefined
        ? { leaseUntil: agent.run.leaseUntil, startedAt: agent.run.startedAt }
        : {}),
      ...(agent.lastRunAt !== undefined ? { lastRunAt: agent.lastRunAt } : {}),
      ...(agent.nextRunAt !== undefined ? { nextRunAt: agent.nextRunAt } : {}),
      found: await countStage(ctx, agent._id, "found"),
      researched: await countScored(ctx, args.orgId, LEAD_SCORE_MIN),
      needsAttention: await countStage(ctx, agent._id, "needs_attention"),
    };
  },
});

/** Parked signals resume only after being toggled off and on. Exhausted signals have consumed their free pages. */
export const byStrategy = query({
  args: { orgId: v.id("orgs") },
  returns: v.array(
    v.object({
      strategyId: v.id("strategies"),
      title: v.string(),
      signalKind: vSignalKind,
      rationale: v.string(),
      enabled: v.boolean(),
      leadsFound: v.number(),
      matchCount: v.number(),
      /** True when the provider estimated that count rather than ran it. */
      matchCountIsApproximate: v.boolean(),
      exhausted: v.boolean(),
      /** Why the run parked this signal; absent when it is healthy. */
      parkedReason: v.optional(vOperationErrorCode),
      lastRunAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const strategies = await ctx.db
      .query("strategies")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
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
        matchCountIsApproximate: strategy.matchCountIsApproximate === true,
        exhausted: strategy.nextPage > MAX_SEARCH_PAGE,
        ...(strategy.lastError !== undefined
          ? { parkedReason: strategy.lastError.code }
          : {}),
        ...(strategy.lastRunAt !== undefined
          ? { lastRunAt: strategy.lastRunAt }
          : {}),
      }));
  },
});

/**
 * Where the org's leads sit, and how they scored — the Dashboard's
 * funnel. One bounded range per stage and per flame score; nothing is
 * post-filtered, so every number is an index range and not a scan.
 */
export const funnel = query({
  args: { orgId: v.id("orgs") },
  returns: v.object({
    bound: v.number(),
    stages: vStageCounts,
    /** Index 0 is score 1. A researched lead is in exactly one of them. */
    scores: v.array(vCount),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
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
      scores.push(await countScored(ctx, args.orgId, score, score));
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
  orgId: Id<"orgs">,
  min: number,
  max?: number,
): Promise<Count> {
  const rows = await ctx.db
    .query("prospects")
    .withIndex("by_orgId_and_scoreKey", (q) => {
      const scoped = q.eq("orgId", orgId).gte("scoreKey", min);
      return max === undefined ? scoped : scoped.lte("scoreKey", max);
    })
    .take(LEAD_COUNT_BOUND + 1);
  return {
    count: Math.min(rows.length, LEAD_COUNT_BOUND),
    hasMore: rows.length > LEAD_COUNT_BOUND,
  };
}
