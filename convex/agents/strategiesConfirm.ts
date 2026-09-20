/**
 * "Confirm & find leads" — the last act of onboarding (PLAN §3 steps 5–6,
 * reference 11).
 *
 * Confirm STARTS NOTHING and SPENDS NOTHING. It compiles the keywords the
 * user picked into one more strategy, counts it for free, and then flips four
 * fields in a single transaction: the agent's revision, its onboarding step,
 * its status, and when the run loop should next pick it up. Everything after
 * that is T30's cron reading `status: "live"` and a due `nextRunAt` — which is
 * why this task needs nothing from that one to compile or to be checked
 * (EXECUTION "API hand-offs").
 *
 * The two halves live here together because they are one decision: what may
 * be confirmed (`confirmContext`, which also authorises) and the flip itself
 * (`finishOnboarding`, which re-checks everything it was told).
 */
import { internalMutation, internalQuery } from "../_generated/server";
import { requireWorkspaceEditor } from "../lib/auth";
import { domainError, invalid, vLeadFilters } from "../lib/validators";
import { getWorkspaceAgent } from "./model";
import {
  keywordFilterLadder,
  keywordStrategyTitle,
  KEYWORD_STRATEGY_RATIONALE,
  mergeFilters,
  strategyIsSelectable,
} from "./strategiesModel";
import { v } from "convex/values";

/** Why confirmation cannot happen yet. Each maps to its own sentence on the
 *  review screen — a disabled button with no reason is the one thing worse
 *  than no button. */
export const vConfirmBlock = v.union(
  v.literal("no_agent"),
  v.literal("no_enabled_strategy"),
);

/** The same blocks, plus the one the action answers with its own status:
 *  setup that is already finished is not a refusal, it is a repeat. */
const vContextBlock = v.union(
  v.literal("no_agent"),
  v.literal("already_done"),
  v.literal("no_enabled_strategy"),
);

const vConfirmContext = v.union(
  v.object({ status: v.literal("blocked"), reason: vContextBlock }),
  v.object({
    status: v.literal("ready"),
    agentId: v.id("agents"),
    keywords: v.array(v.string()),
    /**
     * The keyword strategy's filter set at each place a phrase can be
     * looked for, best first. Empty when the user picked no keywords —
     * "No keywords needed" is a real path (reference 10).
     */
    keywordVariants: v.array(vLeadFilters),
    excludeFilters: vLeadFilters,
  }),
);

/**
 * What the confirm action may do, and whether the caller may do it.
 *
 * The keyword strategy is built on the CORE strategy's own filters rather
 * than on a fresh compile of the ICP, so it inherits whatever the relax pass
 * decided — the user is looking at those counts, and a keyword search under
 * a narrower customer than the cards showed would find nobody.
 */
export const confirmContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: vConfirmContext,
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
    if (agent === null) {
      return { status: "blocked" as const, reason: "no_agent" as const };
    }
    if (agent.onboardingStep === "done") {
      return { status: "blocked" as const, reason: "already_done" as const };
    }

    const strategies = await ctx.db
      .query("strategies")
      .withIndex("by_agentId_and_enabled", (q) =>
        q.eq("agentId", agent._id).eq("enabled", true),
      )
      .collect();
    const usable = strategies.filter((strategy) =>
      strategyIsSelectable(strategy.matchCount),
    );
    if (usable.length === 0) {
      return {
        status: "blocked" as const,
        reason: "no_enabled_strategy" as const,
      };
    }

    const core =
      usable.find((strategy) => strategy.signalKind === "core_icp") ?? usable[0];
    return {
      status: "ready" as const,
      agentId: agent._id,
      keywords: agent.keywords,
      keywordVariants: keywordFilterLadder(agent.keywords).map((variant) =>
        mergeFilters(core.filters, variant),
      ),
      excludeFilters: core.excludeFilters,
    };
  },
});

/**
 * The flip, in one transaction (EXECUTION T23 "Done when").
 *
 * `revision` moves because the agent's search set has just changed, so
 * anything queued under the old one is superseded (PLAN §9.1). `nextRunAt` is
 * now, which is the entire handover to the run loop.
 *
 * Idempotent: a second confirm finds the agent already `done` and returns
 * without inserting the keyword strategy twice.
 */
export const finishOnboarding = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    /** Present only when the user picked keywords AND they match someone. */
    keywordStrategy: v.optional(
      v.object({
        filters: vLeadFilters,
        excludeFilters: vLeadFilters,
        matchCount: v.number(),
      }),
    ),
  },
  returns: v.object({
    status: v.union(v.literal("confirmed"), v.literal("already_done")),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    if (agent.onboardingStep === "done") {
      return { status: "already_done" as const };
    }

    const enabled = await ctx.db
      .query("strategies")
      .withIndex("by_agentId_and_enabled", (q) =>
        q.eq("agentId", agent._id).eq("enabled", true),
      )
      .collect();
    if (!enabled.some((strategy) => strategyIsSelectable(strategy.matchCount))) {
      throw invalid(
        "switch on at least one signal that matches people before confirming",
      );
    }

    const now = Date.now();
    const keyword = args.keywordStrategy;
    if (keyword !== undefined && strategyIsSelectable(keyword.matchCount)) {
      await ctx.db.insert("strategies", {
        workspaceId: args.workspaceId,
        agentId: agent._id,
        title: keywordStrategyTitle(agent.keywords),
        signalKind: "keyword",
        rationale: KEYWORD_STRATEGY_RATIONALE,
        filters: keyword.filters,
        excludeFilters: keyword.excludeFilters,
        matchCount: keyword.matchCount,
        enabled: true,
        source: "recommended",
        nextPage: 1,
        leadsFound: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch("agents", agent._id, {
      onboardingStep: "done",
      status: "live",
      // The whole handover to the run loop: due now (EXECUTION "API
      // hand-offs"). Nothing here schedules anything itself.
      nextRunAt: now,
      revision: agent.revision + 1,
      updatedAt: now,
    });
    return { status: "confirmed" as const };
  },
});
