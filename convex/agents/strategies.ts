/**
 * Search strategies — the public half of onboarding dot 4 (PLAN §3,
 * references 09–11).
 *
 * Six functions, and the boundary each one guards:
 *
 *   `overview`             everything the three screens render, from real
 *                          rows: the cards with their real match counts, the
 *                          live state of the recommendation, the suggested
 *                          and chosen keywords.
 *   `startRecommendation`  the only authenticated part of a paid run. It
 *                          checks the role, spends a rate-limit token,
 *                          records `generating` so the screen shows live
 *                          status from its own reactive query, and schedules
 *                          the internal action that may spend money.
 *   `setSelection`         which strategies are switched on during setup. A
 *                          strategy that matches nobody cannot be switched
 *                          on, whatever the client sends.
 *   `saveKeywords`         the words the user picked, bounded and deduped.
 *   `generateMoreKeywords` the one button on dot 4 that always costs credits.
 *   `confirm`              the end of setup. It counts the keyword strategy
 *                          for free and flips the agent live in one
 *                          transaction; it starts nothing and spends nothing.
 *
 * The paid halves live in `strategiesGeneration.ts`, the fenced writes that
 * end them in `strategiesResult.ts`, the confirmation in
 * `strategiesConfirm.ts`, and the plain logic in `strategiesModel.ts`.
 */
import { internal } from "../_generated/api";
import { action, mutation, query } from "../_generated/server";
import { requireWorkspaceEditor, requireWorkspaceMember } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import {
  domainError,
  invalid,
  vGenerationStatus,
  vSignalKind,
  vStrategySource,
} from "../lib/validators";
import type { LeadFilters } from "../lib/validators";
import { getWorkspaceAgent } from "./model";
import { vConfirmBlock } from "./strategiesConfirm";
import {
  boundedKeywords,
  STRATEGY_GENERATION_STALE_AFTER_MS,
  strategyIsSelectable,
  strategyOperationKey,
} from "./strategiesModel";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* What the three screens read                                          */
/* ------------------------------------------------------------------ */

const vStrategyCard = v.object({
  _id: v.id("strategies"),
  title: v.string(),
  signalKind: vSignalKind,
  /** One sentence for the card's info tooltip (reference 09). */
  rationale: v.string(),
  /** A real count from a free count call. Zero means zero. */
  matchCount: v.number(),
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
 * Everything dot 4 shows. Membership rather than editor: a viewer may look at
 * what the agent searches for, and nothing here is a provider's vocabulary —
 * the filter sets themselves stay on the server (PLAN §4).
 */
export const overview = query({
  args: { workspaceId: v.id("workspaces") },
  returns: vStrategyOverview,
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
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
      .collect();
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

/* ------------------------------------------------------------------ */
/* Recommending them                                                    */
/* ------------------------------------------------------------------ */

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

/**
 * Start a recommendation run.
 *
 * The free first run is the automatic one: nothing here prices the call — the
 * credit wrapper does, from the ledger — so pressing Regenerate is what costs
 * three credits and the screen only has to say so.
 *
 * Only while the agent is a DRAFT. Once setup is confirmed the strategies
 * have page cursors and leads behind them, and replacing them wholesale is
 * not something a Regenerate button may do; the Agent page edits them one at
 * a time instead.
 */
export const startRecommendation = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    reason: vRecommendationReason,
  },
  returns: vStartResult,
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
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
        workspaceId: args.workspaceId,
        agentId: agent._id,
        startedAt: now,
        operationKey: await strategyOperationKey({
          workspaceId: args.workspaceId,
          purpose: "signals",
          startedAt: now,
        }),
      },
    );
    return { status: "started", startedAt: now } as const;
  },
});

/* ------------------------------------------------------------------ */
/* Choosing them                                                        */
/* ------------------------------------------------------------------ */

/**
 * Which strategies are switched on, as the cards on reference 09 have them.
 *
 * Whole-set rather than per-card: the screen holds one selection and sends it,
 * which is what makes Previous, Next and a refresh all show the same thing.
 *
 * This is the SETUP control. After setup the Agent page toggles one signal at
 * a time (`agents/settings.ts`), which is a different act with a different
 * consequence — it changes what the next run does.
 */
export const setSelection = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    /** The strategies that should be on. Everything else is switched off. */
    strategyIds: v.array(v.id("strategies")),
  },
  returns: v.object({ enabled: v.number() }),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
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

/* ------------------------------------------------------------------ */
/* Keywords                                                             */
/* ------------------------------------------------------------------ */

/** The words the user picked on reference 10. Empty is a real answer: "No
 *  keywords needed" skips the screen entirely. */
export const saveKeywords = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    keywords: v.array(v.string()),
  },
  returns: v.object({ keywords: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
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
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ status: v.literal("started") }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);
    const agent = await getWorkspaceAgent(ctx, args.workspaceId);
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
        workspaceId: args.workspaceId,
        agentId: agent._id,
        operationKey: await strategyOperationKey({
          workspaceId: args.workspaceId,
          purpose: "keywords",
          startedAt,
        }),
      },
    );
    return { status: "started" as const };
  },
});

/* ------------------------------------------------------------------ */
/* Finishing setup                                                      */
/* ------------------------------------------------------------------ */

const vConfirmResult = v.union(
  v.object({ status: v.literal("confirmed") }),
  v.object({ status: v.literal("already_done") }),
  v.object({ status: v.literal("blocked"), reason: vConfirmBlock }),
);

/**
 * "Confirm & find leads" (reference 11).
 *
 * An action rather than a mutation for exactly one reason: the keyword
 * strategy is COUNTED before it is stored, and a count is a network call. The
 * count is free and the flip that follows it is one transaction, so
 * confirming still spends nothing and starts nothing — the run loop picks the
 * agent up on its own once `nextRunAt` is due.
 *
 * A user who picked no keywords, or whose keywords match nobody, is confirmed
 * exactly the same way with one strategy fewer.
 */
export const confirm = action({
  args: { workspaceId: v.id("workspaces") },
  returns: vConfirmResult,
  handler: async (ctx, args): Promise<typeof vConfirmResult.type> => {
    const context = await ctx.runQuery(
      internal.agents.strategiesConfirm.confirmContext,
      { workspaceId: args.workspaceId },
    );
    if (context.status === "blocked") {
      return context.reason === "already_done"
        ? { status: "already_done" as const }
        : { status: "blocked" as const, reason: context.reason };
    }

    // Free, and at most three of them: the ladder stops at the first place
    // these phrases actually find people (`strategiesModel.ts`).
    let keywordStrategy:
      | { filters: LeadFilters; excludeFilters: LeadFilters; matchCount: number }
      | undefined;
    for (const filters of context.keywordVariants) {
      const counted = await ctx.runAction(
        internal.integrations.enrich.search.countLeads,
        { filters, excludeFilters: context.excludeFilters },
      );
      if (counted.status === "counted" && counted.count > 0) {
        keywordStrategy = {
          filters,
          excludeFilters: context.excludeFilters,
          matchCount: counted.count,
        };
        break;
      }
    }

    return await ctx.runMutation(
      internal.agents.strategiesConfirm.finishOnboarding,
      {
        workspaceId: args.workspaceId,
        ...(keywordStrategy === undefined ? {} : { keywordStrategy }),
      },
    );
  },
});
