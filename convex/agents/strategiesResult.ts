/**
 * The writes that end a recommendation run (PLAN §3 steps 3–5).
 *
 * Separate from the action that produced them because these are the only
 * places `strategyGeneration` may leave `generating`, and because they are
 * internal: the browser starts a run and reads its status, and never writes
 * either.
 *
 * Every write is FENCED on `startedAt`. A run that has been superseded — the
 * user pressed Regenerate while the first one was still going — must not land
 * its answer on top of the newer one, so a late report whose `startedAt` is
 * not the one the agent is waiting for is dropped rather than applied.
 *
 * The one rule the store keeps, and the whole point of counting first
 * (EXECUTION T23 "Done when"): A STRATEGY THAT MATCHES NOBODY IS NEVER
 * PRE-CHECKED. `enabled` is `recommended && matchCount > 0`, so the first run
 * a user starts can only spend a search on a strategy that has people in it.
 */
import { internalMutation } from "../_generated/server";
import {
  AGENT_KEYWORD_MAX_LENGTH,
  AGENT_SUGGESTED_KEYWORDS_MAX,
  vLeadFilters,
  vOperationErrorCode,
  vSignalKind,
} from "../lib/validators";
import { boundedPhrases } from "../ai/recommendStrategies";
import { strategyIsSelectable } from "./strategiesModel";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/** One strategy, compiled, checked and counted, ready to be a row. */
export const vCompiledStrategy = v.object({
  title: v.string(),
  signalKind: vSignalKind,
  rationale: v.string(),
  filters: vLeadFilters,
  excludeFilters: vLeadFilters,
  /** A real count from a free count call — never an estimate (PLAN §2). */
  matchCount: v.number(),
  /** Whether the model would switch this one on. */
  recommended: v.boolean(),
});

export type CompiledStrategy = Infer<typeof vCompiledStrategy>;

/**
 * End the run `startedAt` began: replace the recommended strategies with what
 * it produced, or record the mapped failure code the screen turns into our
 * own copy.
 *
 * A regeneration REPLACES the recommended rows and leaves anything the user
 * added themselves (`source: "user"`) alone — they did not ask for their own
 * work to be thrown away. Nothing here can run against a live agent: the
 * public mutation only starts a run while the agent is still a draft, so no
 * row being deleted can have a page cursor or leads behind it.
 */
export const finishRecommendation = internalMutation({
  args: {
    agentId: v.id("agents"),
    startedAt: v.number(),
    outcome: v.union(
      v.object({
        state: v.literal("ready"),
        strategies: v.array(vCompiledStrategy),
        keywords: v.array(v.string()),
      }),
      v.object({ state: v.literal("failed"), code: vOperationErrorCode }),
    ),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { applied: false };
    }
    const status = agent.strategyGeneration;
    if (status?.state !== "generating" || status.startedAt !== args.startedAt) {
      // Superseded, or already reported. The newer run owns the row.
      return { applied: false };
    }

    const now = Date.now();
    if (args.outcome.state === "failed") {
      await ctx.db.patch("agents", args.agentId, {
        strategyGeneration: {
          state: "failed",
          code: args.outcome.code,
          at: now,
        },
        updatedAt: now,
      });
      return { applied: true };
    }

    const existing = await ctx.db
      .query("strategies")
      .withIndex("by_agentId_and_enabled", (q) => q.eq("agentId", args.agentId))
      .collect();
    for (const strategy of existing) {
      if (strategy.source === "recommended") {
        await ctx.db.delete("strategies", strategy._id);
      }
    }

    for (const strategy of args.outcome.strategies) {
      await ctx.db.insert("strategies", {
        workspaceId: agent.workspaceId,
        agentId: args.agentId,
        title: strategy.title,
        signalKind: strategy.signalKind,
        rationale: strategy.rationale,
        filters: strategy.filters,
        excludeFilters: strategy.excludeFilters,
        matchCount: strategy.matchCount,
        // The rule: nothing with zero matches starts switched on.
        enabled:
          strategy.recommended && strategyIsSelectable(strategy.matchCount),
        source: "recommended",
        nextPage: 1,
        leadsFound: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch("agents", args.agentId, {
      strategyGeneration: { state: "ready", generatedAt: now },
      suggestedKeywords: boundedPhrases(
        args.outcome.keywords,
        AGENT_SUGGESTED_KEYWORDS_MAX,
        AGENT_KEYWORD_MAX_LENGTH,
      ),
      updatedAt: now,
    });
    return { applied: true };
  },
});

/**
 * Add what "Generate more" produced to the suggestion pool (reference 10).
 *
 * Suggestions ACCUMULATE rather than replace: the user may have been about to
 * click one of the chips already on screen, and a paid run that removed it
 * would be the most annoying possible outcome. Words already chosen or
 * already suggested are dropped, so the pool never repeats itself.
 */
export const addSuggestedKeywords = internalMutation({
  args: {
    agentId: v.id("agents"),
    keywords: v.array(v.string()),
  },
  returns: v.object({ added: v.number() }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { added: 0 };
    }
    const taken = new Set(
      [...agent.keywords, ...(agent.suggestedKeywords ?? [])].map((word) =>
        word.toLocaleLowerCase(),
      ),
    );
    const fresh = boundedPhrases(
      args.keywords,
      AGENT_SUGGESTED_KEYWORDS_MAX,
      AGENT_KEYWORD_MAX_LENGTH,
    ).filter((word) => !taken.has(word.toLocaleLowerCase()));
    if (fresh.length === 0) {
      return { added: 0 };
    }
    const merged = [...(agent.suggestedKeywords ?? []), ...fresh].slice(
      0,
      AGENT_SUGGESTED_KEYWORDS_MAX,
    );
    await ctx.db.patch("agents", args.agentId, {
      suggestedKeywords: merged,
      updatedAt: Date.now(),
    });
    return { added: merged.length - (agent.suggestedKeywords?.length ?? 0) };
  },
});
