/**
 * The paid half of onboarding dot 4 (PLAN §3 steps 3–4, references 09–10).
 *
 * Scheduled by `agents.strategies` and reachable from nowhere else. Neither
 * action throws at its caller — the scheduler has no one to tell — so each
 * ends by reporting to a fenced write in `strategiesResult.ts`, either with
 * what it produced or with ONE mapped failure code, and a run always leaves
 * the screen in a state the user can act on.
 *
 * What happens between the model and the write is the point of this file:
 *
 *   1. the core ICP filters arrive already compiled (`strategiesModel.ts`) —
 *      the model is never asked for them and never trusted with them;
 *   2. every filter the model DID write is re-checked, for free and with no
 *      network call, by `filterOptions.validateFilters`, and a strategy whose
 *      signal half does not survive that is dropped rather than repaired into
 *      something nobody asked for;
 *   3. every surviving strategy is COUNTED, for free, so the cards on
 *      reference 09 show a real number and never an estimate;
 *   4. a strategy that matches too few or absurdly many gets ONE automatic
 *      relax or tighten pass — in plain code, so it costs another free count
 *      and no credits at all.
 */
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import {
  boundStrategyRecommendation,
  GENERATE_KEYWORDS_SYSTEM,
  keywordGenerationInput,
  RECOMMEND_STRATEGIES_SYSTEM,
  SIGNAL_FILTER_SPECS,
  shortlistSignalValues,
  strategyRecommendationInput,
  vKeywordSuggestions,
  vStrategyRecommendation,
} from "../ai/recommendStrategies";
import type {
  RecommendedStrategy,
  SignalFilterOffer,
} from "../ai/recommendStrategies";
import { runStructured } from "../ai/run";
import type { RefundReason } from "../billing/paidCall";
import { getOrgProfile } from "../company/model";
import { vLeadFilters } from "../lib/validators";
import type {
  LeadFilters,
  OperationErrorCode,
  SignalKind,
} from "../lib/validators";
import { companySizeBand } from "./icpVocabulary";
import { getOrgAgent } from "./model";
import {
  compileCoreFilters,
  compileExcludeFilters,
  CORE_STRATEGY_RATIONALE,
  CORE_STRATEGY_TITLE,
  entriesToExcludeFilters,
  entriesToSignalFilters,
  inferRoleFilters,
  mergeExcludeFilters,
  mergeFilters,
  readFilterCatalogue,
  relaxFilters,
  STRATEGY_MIN_USEFUL_MATCHES,
  STRATEGY_TOO_MANY_MATCHES,
  tightenFilters,
} from "./strategiesModel";
import type { CompiledStrategy } from "./strategiesResult";
import { v } from "convex/values";

/* ------------------------------------------------------------------ */
/* What a recommendation needs before it can ask                        */
/* ------------------------------------------------------------------ */

const vRecommendationInput = v.union(
  v.null(),
  v.object({
    /**
     * The whole user half of the call, already written. The prompt is built
     * here rather than in the action because everything it needs — the
     * profile, the ideal customer and the cached allowed values — is read in
     * this transaction, and a validator for the vocabulary would be larger
     * than the string it describes.
     */
    prompt: v.string(),
    /** The ideal customer as filters. Never the model's to write. */
    coreFilters: vLeadFilters,
    excludeFilters: vLeadFilters,
    /** The broader way to say the ICP's job titles, for the relax pass. */
    roleFilters: vLeadFilters,
  }),
);

/**
 * The profile, the ideal customer and the signal vocabulary, or `null` when
 * there is nothing to recommend from — the org was cleared under a
 * scheduled run, or the filter catalogue has never been fetched, and either
 * way asking the model would produce filters nobody could check.
 */
export const recommendationInput = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: vRecommendationInput,
  handler: async (ctx, args) => {
    const agent = await getOrgAgent(ctx, args.orgId);
    const profile = await getOrgProfile(ctx, args.orgId);
    const options = await readFilterCatalogue(ctx);
    if (agent === null || profile === null || options === null) {
      return null;
    }

    const icp = agent.icp;
    const profileText = [
      profile.companyName,
      profile.industry,
      profile.description,
      ...profile.keyFeatures,
    ].join(" ");

    const signals: SignalFilterOffer[] = [];
    for (const spec of SIGNAL_FILTER_SPECS) {
      if (spec.kind !== "values") {
        signals.push(spec);
        continue;
      }
      const values = options[spec.key]?.values ?? [];
      if (values.length === 0) {
        // The catalogue carries no values for this filter, so nothing the
        // model picked could be checked — and an unchecked value is a silent
        // zero (spikes §3). Not offering it is the honest answer.
        continue;
      }
      signals.push({
        ...spec,
        values: shortlistSignalValues(values, profileText),
      });
    }

    return {
      prompt: strategyRecommendationInput({
        profile: {
          companyName: profile.companyName,
          industry: profile.industry,
          description: profile.description,
          keyFeatures: profile.keyFeatures,
          painPoints: profile.painPoints,
        },
        icp: {
          jobTitles: icp.jobTitles,
          industries: icp.industries,
          locations: icp.locations,
          companyTypes: icp.companyTypes,
          // Our own bands, by the label a person would read.
          companySizes: icp.companySizes.map(
            (value) => companySizeBand(value)?.label ?? value,
          ),
        },
        signals,
      }),
      coreFilters: compileCoreFilters({ icp, options }),
      excludeFilters: compileExcludeFilters(icp),
      roleFilters: inferRoleFilters({ jobTitles: icp.jobTitles, options }),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Mapping a refusal to one of our own codes                            */
/* ------------------------------------------------------------------ */

/** Money and capacity keep their own code because the screen offers a
 *  different next step for each; everything else collapses into the sentence
 *  the user actually needs. */
function codeForRefund(reason: RefundReason): OperationErrorCode {
  switch (reason) {
    case "kill_switch":
      return "platform_paused";
    case "no_credit_grant":
    case "insufficient_credits":
    case "trial_limit_reached":
      return "insufficient_credits";
    case "rate_limited":
    case "throttled":
      return "rate_limited";
    case "platform_capacity":
    case "unauthorized":
      return "provider_unavailable";
    case "validation":
    case "provider_charged_nothing":
      return "invalid_response";
    case "unknown":
      return "unknown";
  }
}

/** A THROWN failure: the request left us and nobody knows what it did, so the
 *  hold parks as `uncertain` and a sweep owns it (PLAN §6). */
const CODE_FOR_UNCERTAIN: OperationErrorCode = "provider_unavailable";

/* ------------------------------------------------------------------ */
/* Checking and counting, both free                                     */
/* ------------------------------------------------------------------ */

/** A filter set the builder accepts, or `null`. No network, no credits. */
async function accepted(
  ctx: ActionCtx,
  filters: LeadFilters,
  excludeFilters: LeadFilters,
): Promise<boolean> {
  const check = await ctx.runQuery(
    internal.agents.filterOptions.validateFilters,
    { filters, excludeFilters },
  );
  return check.ok;
}

/** How many people match. FREE, and the only honest source of the number the
 *  cards show. A failure keeps its own code so the screen can say whether the
 *  platform is paused or something simply did not answer. */
type Counted =
  | { ok: true; count: number }
  | { ok: false; code: OperationErrorCode };

async function countOf(
  ctx: ActionCtx,
  filters: LeadFilters,
  excludeFilters: LeadFilters,
): Promise<Counted> {
  const counted = await ctx.runAction(
    internal.integrations.enrich.search.countLeads,
    { filters, excludeFilters },
  );
  return counted.status === "counted"
    ? { ok: true, count: counted.count }
    : { ok: false, code: counted.code };
}

/**
 * ONE automatic pass over a counted strategy (PLAN §3 step 4).
 *
 * Widening and narrowing are both plain edits of the filter set, so the pass
 * spends nothing: one more free count decides whether the edit was an
 * improvement, and a pass that made things worse is discarded rather than
 * stored. Nothing here asks the model a second time.
 */
async function adjustOnce(
  ctx: ActionCtx,
  args: {
    filters: LeadFilters;
    excludeFilters: LeadFilters;
    matchCount: number;
    roleFilters: LeadFilters;
  },
): Promise<{ filters: LeadFilters; matchCount: number }> {
  const keep = { filters: args.filters, matchCount: args.matchCount };
  const candidate =
    args.matchCount < STRATEGY_MIN_USEFUL_MATCHES
      ? relaxFilters(args.filters, args.roleFilters)
      : args.matchCount > STRATEGY_TOO_MANY_MATCHES
        ? tightenFilters(args.filters)
        : null;
  if (candidate === null) {
    return keep;
  }
  if (!(await accepted(ctx, candidate, args.excludeFilters))) {
    return keep;
  }
  const counted = await countOf(ctx, candidate, args.excludeFilters);
  if (!counted.ok) {
    return keep;
  }
  const better =
    args.matchCount < STRATEGY_MIN_USEFUL_MATCHES
      ? counted.count > args.matchCount
      : counted.count > 0 && counted.count < args.matchCount;
  return better ? { filters: candidate, matchCount: counted.count } : keep;
}

/* ------------------------------------------------------------------ */
/* The model's answer, turned into strategies                           */
/* ------------------------------------------------------------------ */

type RecommendationContext = {
  coreFilters: LeadFilters;
  excludeFilters: LeadFilters;
  roleFilters: LeadFilters;
};

/** The always-present core strategy, whether or not the model named one. */
function coreStrategyOf(
  strategies: readonly RecommendedStrategy[],
): { title: string; rationale: string } {
  const named = strategies.find((entry) => entry.signalKind === "core_icp");
  return {
    title:
      named === undefined || named.title.length === 0
        ? CORE_STRATEGY_TITLE
        : named.title,
    // The card's tooltip is the rationale, so an empty one would leave the
    // always-present card as the only one that explains nothing.
    rationale:
      named === undefined || named.rationale.length === 0
        ? CORE_STRATEGY_RATIONALE
        : named.rationale,
  };
}

/**
 * Compile, check and count every strategy — the whole of PLAN §3 steps 3–4
 * after the model has answered.
 *
 * The core strategy is built first and separately: it is the one that must
 * exist, and if IT cannot be counted there is nothing to show the user, so
 * the run fails rather than presenting an empty screen.
 */
async function compileStrategies(
  ctx: ActionCtx,
  args: {
    context: RecommendationContext;
    strategies: readonly RecommendedStrategy[];
  },
): Promise<
  { ok: true; strategies: CompiledStrategy[] } | { ok: false; code: OperationErrorCode }
> {
  const { coreFilters, excludeFilters, roleFilters } = args.context;
  if (!(await accepted(ctx, coreFilters, excludeFilters))) {
    // The ideal customer itself does not survive the filter builder, which is
    // a stale catalogue rather than a bad answer from the model.
    return { ok: false, code: "provider_unavailable" };
  }
  const coreCount = await countOf(ctx, coreFilters, excludeFilters);
  if (!coreCount.ok) {
    return { ok: false, code: coreCount.code };
  }
  const core = coreStrategyOf(args.strategies);
  const adjustedCore = await adjustOnce(ctx, {
    filters: coreFilters,
    excludeFilters,
    matchCount: coreCount.count,
    roleFilters,
  });
  const compiled: CompiledStrategy[] = [
    {
      title: core.title,
      signalKind: "core_icp",
      rationale: core.rationale,
      filters: adjustedCore.filters,
      excludeFilters,
      matchCount: adjustedCore.matchCount,
      recommended: true,
    },
  ];

  const used = new Set<SignalKind>(["core_icp", "keyword"]);
  for (const strategy of args.strategies) {
    if (used.has(strategy.signalKind) || strategy.title.length === 0) {
      continue;
    }
    const signalFilters = entriesToSignalFilters(
      strategy.filters,
      strategy.signalKind,
    );
    if (Object.keys(signalFilters).length === 0) {
      // Nothing of the signal survived the vocabulary check, so this card
      // would be the core strategy under another name.
      continue;
    }
    used.add(strategy.signalKind);

    const filters = mergeFilters(coreFilters, signalFilters);
    const excludes = mergeExcludeFilters(
      excludeFilters,
      entriesToExcludeFilters(strategy.excludeFilters),
    );
    const checked = (await accepted(ctx, filters, excludes))
      ? excludes
      : (await accepted(ctx, filters, excludeFilters))
        ? excludeFilters
        : null;
    if (checked === null) {
      continue;
    }
    const count = await countOf(ctx, filters, checked);
    if (!count.ok) {
      // No real count, so no card: a made-up number is worse than one card
      // fewer (PLAN §2).
      continue;
    }
    const adjusted = await adjustOnce(ctx, {
      filters,
      excludeFilters: checked,
      matchCount: count.count,
      roleFilters,
    });
    compiled.push({
      title: strategy.title,
      signalKind: strategy.signalKind,
      rationale: strategy.rationale,
      filters: adjusted.filters,
      excludeFilters: checked,
      matchCount: adjusted.matchCount,
      recommended: strategy.recommended,
    });
  }
  return { ok: true, strategies: compiled };
}

/* ------------------------------------------------------------------ */
/* The recommendation run                                               */
/* ------------------------------------------------------------------ */

export const recommend = internalAction({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    startedAt: v.number(),
    operationKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const fail = async (code: OperationErrorCode): Promise<null> => {
      await ctx.runMutation(
        internal.agents.strategiesResult.finishRecommendation,
        {
          agentId: args.agentId,
          startedAt: args.startedAt,
          outcome: { state: "failed", code },
        },
      );
      return null;
    };

    const input = await ctx.runQuery(
      internal.agents.strategiesGeneration.recommendationInput,
      { orgId: args.orgId },
    );
    if (input === null) {
      return await fail("not_found");
    }

    let ai;
    try {
      ai = await runStructured(ctx, {
        orgId: args.orgId,
        action: "recommend_signals",
        tier: "smart",
        system: RECOMMEND_STRATEGIES_SYSTEM,
        input: input.prompt,
        result: vStrategyRecommendation,
        operationKey: args.operationKey,
      });
    } catch {
      return await fail(CODE_FOR_UNCERTAIN);
    }
    if (ai.kind === "refunded") {
      return await fail(codeForRefund(ai.reason));
    }
    if (ai.kind === "uncertain" || ai.replayed) {
      return await fail(CODE_FOR_UNCERTAIN);
    }
    if (ai.result.status === "invalid_response") {
      return await fail("invalid_response");
    }

    const bounded = boundStrategyRecommendation(ai.result.object);
    const compiled = await compileStrategies(ctx, {
      context: {
        coreFilters: input.coreFilters,
        excludeFilters: input.excludeFilters,
        roleFilters: input.roleFilters,
      },
      strategies: bounded.strategies,
    });
    if (!compiled.ok) {
      // The ideal customer itself could not be checked or counted, so there
      // is no screen to show — and the code says which of the two it was.
      return await fail(compiled.code);
    }

    await ctx.runMutation(
      internal.agents.strategiesResult.finishRecommendation,
      {
        agentId: args.agentId,
        startedAt: args.startedAt,
        outcome: {
          state: "ready",
          strategies: compiled.strategies,
          keywords: bounded.keywords,
        },
      },
    );
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* "Generate more" keywords (reference 10)                              */
/* ------------------------------------------------------------------ */

const vKeywordInput = v.union(
  v.null(),
  v.object({ prompt: v.string() }),
);

export const keywordInput = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: vKeywordInput,
  handler: async (ctx, args) => {
    const agent = await getOrgAgent(ctx, args.orgId);
    const profile = await getOrgProfile(ctx, args.orgId);
    if (agent === null || profile === null) {
      return null;
    }
    return {
      prompt: keywordGenerationInput({
        profile: {
          companyName: profile.companyName,
          industry: profile.industry,
          description: profile.description,
        },
        jobTitles: agent.icp.jobTitles,
        existing: [...agent.keywords, ...(agent.suggestedKeywords ?? [])],
      }),
    };
  },
});

/**
 * More suggestions for the keyword screen. Always paid (`generate_keywords`
 * has no free first run), which is why the button says its price before it is
 * pressed.
 *
 * A failed run writes nothing: the suggestions already on screen are still
 * good, and the screen says the request did not land rather than clearing
 * them.
 */
export const generateMore = internalAction({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    operationKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const input = await ctx.runQuery(
      internal.agents.strategiesGeneration.keywordInput,
      { orgId: args.orgId },
    );
    if (input === null) {
      return null;
    }
    let ai;
    try {
      ai = await runStructured(ctx, {
        orgId: args.orgId,
        action: "generate_keywords",
        tier: "smart",
        system: GENERATE_KEYWORDS_SYSTEM,
        input: input.prompt,
        result: vKeywordSuggestions,
        operationKey: args.operationKey,
      });
    } catch {
      return null;
    }
    if (ai.kind !== "billed" || ai.replayed) {
      return null;
    }
    if (ai.result.status === "invalid_response") {
      return null;
    }
    await ctx.runMutation(internal.agents.strategiesResult.addSuggestedKeywords, {
      agentId: args.agentId,
      keywords: ai.result.object.keywords,
    });
    return null;
  },
});
