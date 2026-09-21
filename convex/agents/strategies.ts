import { internal } from "../_generated/api";
import { action, mutation, query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { COUNT_SCAN_BOUND } from "../lib/limits";
import { requireRateLimit } from "../lib/rateLimits";
import {
  domainError,
  invalid,
  vGenerationStatus,
  vSignalKind,
  vStrategySource,
} from "../lib/validators";
import type { LeadFilters } from "../lib/validators";
import { getOrgAgent } from "./model";
import { vConfirmBlock } from "./strategiesConfirm";
import {
  boundedKeywords,
  STRATEGY_GENERATION_STALE_AFTER_MS,
  strategyIsSelectable,
  strategyOperationKey,
} from "./strategiesModel";
import { v } from "convex/values";

const vStrategyCard = v.object({
  _id: v.id("strategies"),
  title: v.string(),
  signalKind: vSignalKind,
  /** One sentence for the card's info tooltip (reference 09). */
  rationale: v.string(),
  /** A real count from a free count call. Zero means zero. */
  matchCount: v.number(),
  /** True when the provider estimated that count rather than ran it. The card
   *  says "About N" instead of pretending to a precision nobody has. */
  matchCountIsApproximate: v.boolean(),
  enabled: v.boolean(),
  source: vStrategySource,
});

const vStrategyOverview = v.object({
  /** `null` before the first run was ever asked for. */
  generation: v.union(vGenerationStatus, v.null()),
  strategies: v.array(vStrategyCard),
  /** The model's suggestions the user has not taken (reference 10). */
  suggestedKeywords: v.array(v.string()),
  /** The words the user has chosen. */
  keywords: v.array(v.string()),
});

/**
 * Everything dot 4 shows. Guarded by the active organization, like every
 * other entry point, and nothing here is a provider's vocabulary — the
 * filter sets themselves stay on the server (PLAN §4).
 */
export const overview = query({
  args: { orgId: v.id("orgs") },
  returns: vStrategyOverview,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      return {
        generation: null,
        strategies: [],
        suggestedKeywords: [],
        keywords: [],
      };
    }
    const rows = await ctx.db
      .query("strategies")
      .withIndex("by_agentId_and_enabled", (q) => q.eq("agentId", agent._id))
      .take(COUNT_SCAN_BOUND);
    // The index orders by `enabled` before creation, which would shuffle the
    // cards every time one is ticked. The order the user sees is the order
    // they were written in, with the ideal-customer card first.
    const strategies = rows
      .sort((a, b) => a._creationTime - b._creationTime)
      .sort(
        (a, b) =>
          Number(b.signalKind === "core_icp") -
          Number(a.signalKind === "core_icp"),
      )
      .map((strategy) => ({
        _id: strategy._id,
        title: strategy.title,
        signalKind: strategy.signalKind,
        rationale: strategy.rationale,
        matchCount: strategy.matchCount,
        matchCountIsApproximate: strategy.matchCountIsApproximate === true,
        enabled: strategy.enabled,
        source: strategy.source,
      }));
    return {
      generation: agent.strategyGeneration ?? null,
      strategies,
      suggestedKeywords: agent.suggestedKeywords ?? [],
      keywords: agent.keywords,
    };
  },
});

/**
 * Why a run is being asked for. It decides which rate-limit bucket pays for
 * it and, more importantly, when the request is a no-op: the signals screen
 * asks for `initial` on entry, so that call has to be safe to make on every
 * mount, on every device, forever.
 */
const vRecommendationReason = v.union(
  v.literal("initial"),
  v.literal("retry"),
  v.literal("regenerate"),
);

const vStartResult = v.union(
  v.object({ status: v.literal("started"), startedAt: v.number() }),
  v.object({
    status: v.literal("skipped"),
    reason: v.union(
      v.literal("already_running"),
      v.literal("already_generated"),
      v.literal("nothing_to_retry"),
    ),
  }),
);

/** Regeneration is draft-only: live strategies have paging cursors and sourced leads that must be preserved. */
export const startRecommendation = mutation({
  args: {
    orgId: v.id("orgs"),
    reason: vRecommendationReason,
  },
  returns: vStartResult,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    if (agent.status !== "draft") {
      throw invalid("this agent has already finished setup");
    }

    const now = Date.now();
    const status = agent.strategyGeneration;
    if (
      status?.state === "generating" &&
      now - status.startedAt < STRATEGY_GENERATION_STALE_AFTER_MS
    ) {
      return { status: "skipped", reason: "already_running" } as const;
    }
    if (args.reason === "initial" && status !== undefined) {
      // The screen asks on every entry; only the very first one runs.
      return { status: "skipped", reason: "already_generated" } as const;
    }
    if (args.reason === "retry" && status?.state !== "failed") {
      return { status: "skipped", reason: "nothing_to_retry" } as const;
    }
    if (agent.icp.jobTitles.length === 0) {
      // Everything downstream is the ideal customer AND one signal, and dot 2
      // is what fills the first half in.
      throw invalid(
        "describe your ideal customer before we look for signals to track",
      );
    }

    // After the no-ops, so a repeated automatic trigger never spends a token.
    await requireRateLimit(
      ctx,
      args.reason === "regenerate" ? "regenerate" : "recommendSignals",
      identityKey,
    );

    await ctx.db.patch("agents", agent._id, {
      strategyGeneration: { state: "generating", startedAt: now },
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.agents.strategiesGeneration.recommend,
      {
        orgId: args.orgId,
        agentId: agent._id,
        startedAt: now,
        operationKey: await strategyOperationKey({
          orgId: args.orgId,
          purpose: "signals",
          startedAt: now,
        }),
      },
    );
    return { status: "started", startedAt: now } as const;
  },
});

/** Replace the whole selection during setup. Live agents toggle individual signals through settings. */
export const setSelection = mutation({
  args: {
    orgId: v.id("orgs"),
    /** The strategies that should be on. Everything else is switched off. */
    strategyIds: v.array(v.id("strategies")),
  },
  returns: v.object({ enabled: v.number() }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    if (agent.onboardingStep === "done") {
      throw invalid("setup is finished; change signals on the agent page");
    }

    const wanted = new Set(args.strategyIds);
    const rows = await ctx.db
      .query("strategies")
      .withIndex("by_agentId_and_enabled", (q) => q.eq("agentId", agent._id))
      .collect();
    const now = Date.now();
    let enabled = 0;
    for (const strategy of rows) {
      // A strategy that matches nobody can never be switched on, whatever the
      // client sends — the run would buy a search that returns an empty page.
      const on =
        wanted.has(strategy._id) && strategyIsSelectable(strategy.matchCount);
      if (on) {
        enabled += 1;
      }
      if (strategy.enabled !== on) {
        await ctx.db.patch("strategies", strategy._id, {
          enabled: on,
          updatedAt: now,
        });
      }
    }
    return { enabled };
  },
});

/** The words the user picked on reference 10. Empty is a real answer: "No
 *  keywords needed" skips the screen entirely. */
export const saveKeywords = mutation({
  args: {
    orgId: v.id("orgs"),
    keywords: v.array(v.string()),
  },
  returns: v.object({ keywords: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    const keywords = boundedKeywords(args.keywords);
    await ctx.db.patch("agents", agent._id, {
      keywords,
      updatedAt: Date.now(),
    });
    return { keywords };
  },
});

/**
 * "Generate more" (reference 10). Always three credits — `generate_keywords`
 * has no free first run — so the button says the price before it is pressed
 * and the screen checks the balance before it offers it.
 */
export const generateMoreKeywords = mutation({
  args: { orgId: v.id("orgs") },
  returns: v.object({ status: v.literal("started") }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const agent = await getOrgAgent(ctx, args.orgId);
    if (agent === null) {
      throw domainError("NOT_FOUND", "this organization has no agent yet");
    }
    await requireRateLimit(ctx, "regenerate", identityKey);
    // The key carries the moment it was asked for, so each press really
    // re-asks the model. Two presses inside one millisecond would share a key
    // and the second would replay — which costs nothing and writes nothing,
    // the safe side of that race.
    const startedAt = Date.now();
    await ctx.scheduler.runAfter(
      0,
      internal.agents.strategiesGeneration.generateMore,
      {
        orgId: args.orgId,
        agentId: agent._id,
        operationKey: await strategyOperationKey({
          orgId: args.orgId,
          purpose: "keywords",
          startedAt,
        }),
      },
    );
    return { status: "started" as const };
  },
});

const vConfirmResult = v.union(
  v.object({ status: v.literal("confirmed") }),
  v.object({ status: v.literal("already_done") }),
  v.object({ status: v.literal("blocked"), reason: vConfirmBlock }),
);

/** Count keyword matches before activation; network I/O requires an action.
 * Invalid or empty keyword searches are omitted without blocking setup. Rate-limit the free provider calls too. */
export const confirm = action({
  args: { orgId: v.id("orgs") },
  returns: vConfirmResult,
  handler: async (ctx, args): Promise<typeof vConfirmResult.type> => {
    const context = await ctx.runQuery(
      internal.agents.strategiesConfirm.confirmContext,
      { orgId: args.orgId },
    );
    if (context.status === "blocked") {
      return context.reason === "already_done"
        ? { status: "already_done" as const }
        : { status: "blocked" as const, reason: context.reason };
    }
    // After the blocks, so a repeated press on a finished setup never spends
    // a token, and before anything reaches a provider.
    await requireRateLimit(ctx, "confirmSignals", context.identityKey);

    // Free, and at most three of them: the ladder stops at the first place
    // these phrases actually find people (`strategiesModel.ts`).
    let keywordStrategy:
      | {
          filters: LeadFilters;
          excludeFilters: LeadFilters;
          matchCount: number;
          matchCountIsApproximate: boolean;
        }
      | undefined;
    for (const filters of context.keywordVariants) {
      // The same no-network check the recommendation run makes before every
      // count. A variant the builder would refuse is skipped, not thrown at
      // the user: setup finishes with one signal fewer.
      const checked = await ctx.runQuery(
        internal.agents.filterOptions.validateFilters,
        { filters, excludeFilters: context.excludeFilters },
      );
      if (!checked.ok) {
        continue;
      }
      const counted = await ctx.runAction(
        internal.integrations.enrich.search.countLeads,
        { filters, excludeFilters: context.excludeFilters },
      );
      if (counted.status === "counted" && counted.count > 0) {
        keywordStrategy = {
          filters,
          excludeFilters: context.excludeFilters,
          matchCount: counted.count,
          // The card this becomes reads the number out loud, so whether the
          // provider counted or estimated it travels with it.
          matchCountIsApproximate: counted.isApproximate,
        };
        break;
      }
    }

    return await ctx.runMutation(
      internal.agents.strategiesConfirm.finishOnboarding,
      {
        orgId: args.orgId,
        ...(keywordStrategy === undefined ? {} : { keywordStrategy }),
      },
    );
  },
});
