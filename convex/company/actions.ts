/**
 * The paid half of website analysis (PLAN §3 step 1, flow.html step 1).
 *
 * Scheduled by `company.mutations.startAnalysis` and reachable from nowhere
 * else: it is where the two provider calls of this step happen, in order —
 * read the site, then turn its markdown into a profile — and both of them go
 * through the credit wrapper inside the modules that own them.
 *
 * The action never throws at its caller: the scheduler has no one to tell. It
 * ends by reporting to `analysis.finishAnalysis`, either with the profile it
 * produced or with ONE mapped failure code, so a run always leaves the screen
 * in a state the user can act on.
 *
 * Provider wording is already gone by the time it gets here: `scrapeSite`
 * hands back typed outcomes and `runStructured` hands back refund reasons.
 * This file only decides which of our own codes each one is (PLAN §4).
 */
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  vWebsiteAnalysis,
  websiteAnalysisInput,
  WEBSITE_ANALYSIS_SYSTEM,
} from "../ai/analyzeWebsite";
import { runStructured } from "../ai/run";
import type { RefundReason } from "../billing/paidCall";
import { scrapeSite } from "../integrations/firecrawl";
import type { OperationErrorCode } from "../lib/validators";
import { v } from "convex/values";

/**
 * How many pages one analysis reads: the home page plus up to three supporting
 * pages (pricing, customers, about). Fixed here, never by user input.
 */
const ANALYSIS_PAGES = 4;

/**
 * A refusal from either paid call, as one of our own codes.
 *
 * Money and capacity keep their own code because the screen offers a different
 * next step for them; everything else that ends with "we could not read this
 * site" collapses into `unreadable_source`, which is the sentence the user
 * actually needs.
 */
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
      return "unreadable_source";
    case "unknown":
      return "unknown";
  }
}

/**
 * A THROWN failure from either paid call.
 *
 * Both wrappers throw for exactly one situation: the request may have left us
 * and nobody knows what it did, so the hold is parked `uncertain` and a sweep
 * owns it (PLAN §6). From the user's side that is always the same fact — this
 * run did not finish, and it was not their doing.
 */
const CODE_FOR_UNCERTAIN: OperationErrorCode = "provider_unavailable";

export const analyze = internalAction({
  args: {
    orgId: v.id("orgs"),
    profileId: v.id("businessProfiles"),
    /** Already admitted and normalised by the mutation that stored it. */
    websiteUrl: v.string(),
    startedAt: v.number(),
    scrapeOperationKey: v.string(),
    aiOperationKey: v.string(),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fail = async (code: OperationErrorCode): Promise<null> => {
      await ctx.runMutation(internal.company.analysis.finishAnalysis, {
        profileId: args.profileId,
        startedAt: args.startedAt,
        updatedBy: args.updatedBy,
        outcome: { state: "failed", code },
      });
      return null;
    };

    /* 1. Read the site. The same operation key replays pages we already own,
          which is what makes Retry after a model failure cost nothing. */
    let scrape;
    try {
      scrape = await scrapeSite(ctx, {
        orgId: args.orgId,
        url: args.websiteUrl,
        pages: ANALYSIS_PAGES,
        action: "analyze_website",
        operationKey: args.scrapeOperationKey,
      });
    } catch {
      return await fail(CODE_FOR_UNCERTAIN);
    }
    if (scrape.kind === "refused") {
      return await fail(codeForRefund(scrape.reason));
    }
    if (scrape.kind === "empty" || scrape.kind === "unavailable") {
      return await fail("unreadable_source");
    }
    if (scrape.kind === "uncertain") {
      return await fail(CODE_FOR_UNCERTAIN);
    }

    /* 2. Turn the markdown into a profile. Zero credits by design: the user
          paid on the step that fetched the pages (`lib/limits.ts`). */
    let ai;
    try {
      ai = await runStructured(ctx, {
        orgId: args.orgId,
        action: "profile_company",
        tier: "smart",
        system: WEBSITE_ANALYSIS_SYSTEM,
        input: websiteAnalysisInput(scrape.site.combinedMarkdown),
        result: vWebsiteAnalysis,
        operationKey: args.aiOperationKey,
      });
    } catch {
      return await fail(CODE_FOR_UNCERTAIN);
    }
    if (ai.kind === "refunded") {
      return await fail(codeForRefund(ai.reason));
    }
    if (ai.kind === "uncertain") {
      return await fail(CODE_FOR_UNCERTAIN);
    }
    if (ai.replayed) {
      // Only reachable if this run's key were reused, which `model.ts` makes
      // impossible — a replayed generation carries no object to save.
      return await fail("unknown");
    }
    if (ai.result.status === "invalid_response") {
      return await fail("invalid_response");
    }

    await ctx.runMutation(internal.company.analysis.finishAnalysis, {
      profileId: args.profileId,
      startedAt: args.startedAt,
      updatedBy: args.updatedBy,
      outcome: { state: "ready", analysis: ai.result.object },
    });
    return null;
  },
});
