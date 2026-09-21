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

/**
 * How far any one count reads. A trial org's whole table is smaller
 * than this, so in practice `hasMore` is false everywhere — the bound is what
 * keeps a query honest if that stops being true.
 *
 * Shared with the dashboard's own scan bound, so the two screens stop
 * counting at the same place: two different bounds meant the same leads
 * produced different totals on Contacts and on the dashboard once either
 * one was passed.
 */
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

/**
 * What the agent is doing right now — the state Contacts renders as "Finding
 * your first leads…" while the first run is still in progress.
 *
 * `running` is the run lease being LIVE, not merely present: an expired lease
 * belongs to an action that is already dead, and telling the user it is still
 * working would be the one piece of fiction on the screen.
 *
 * "Live" is measured against the caller's `now`, never `Date.now()` read in
 * here: a query that reads the wall clock answers differently for the same
 * arguments, so its subscription would keep showing "working…" long after the
 * lease died and would never re-run to correct itself. `leaseUntil` travels
 * too, so a screen can count down without asking again. With no `now` the
 * answer is the honest weaker one — a lease exists — which the recovery
 * sweep clears within ten minutes. Callers should pass a COARSE clock (a
 * value that changes every few seconds at most): a per-millisecond argument
 * is a new subscription key every render.
 */
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

/**
 * Leads generated per signal — the Agent page's table, from the counter the
 * run itself records (`strategies.leadsFound`), so a weak signal is visible
 * and can be switched off.
 *
 * `exhausted` is the honest reason a signal stopped growing: its free pages
 * are used up, which is a different thing from a signal that found nobody.
 *
 * `parkedReason` is the other honest reason: a search refused this signal's
 * filters, so the run skips it until a person switches it off and on again
 * (`agents/sourcing.ts#parkStrategy`). Without it the row would say
 * "enabled" and produce nothing for ever, with nothing to read.
 */
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
