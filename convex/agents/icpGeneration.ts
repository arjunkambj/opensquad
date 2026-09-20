/**
 * The paid half of the ICP (PLAN §3, flow.html step 2).
 *
 * Scheduled by `agents.icp.startGeneration` and reachable from nowhere else.
 * The action never throws at its caller — the scheduler has no one to tell —
 * so it ends by reporting to `finishGeneration`, either with the ICP it
 * produced or with ONE mapped failure code, and a run always leaves the screen
 * in a state the user can act on.
 *
 * The write it reports to is `icpResult.ts`, which is fenced on `startedAt`:
 * a Regenerate pressed while the first run was still going must not have the
 * older answer land on top of it.
 */
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";
import {
  ICP_GENERATION_SYSTEM,
  icpGenerationInput,
  shortlistAllowedValues,
  vIcpGeneration,
} from "../ai/generateIcp";
import { runStructured } from "../ai/run";
import type { RefundReason } from "../billing/paidCall";
import { getOrgProfile } from "../company/model";
import type { OperationErrorCode } from "../lib/validators";
import { EMPTY_ICP_OPTION_LISTS, readIcpOptionLists } from "./icpVocabulary";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/* ------------------------------------------------------------------ */
/* How much vocabulary one call carries                                 */
/* ------------------------------------------------------------------ */

/**
 * The industry catalogue has 454 values and the country list 249 (spikes §3).
 * Sending both in full would take most of the call's character budget and
 * push the company profile itself out of the prompt, so each list is
 * shortlisted against the profile first (`ai/generateIcp.ts`).
 */
const ICP_INDUSTRY_CHOICES = 120;
const ICP_LOCATION_CHOICES = 60;

/* ------------------------------------------------------------------ */
/* What the action needs before it can ask                              */
/* ------------------------------------------------------------------ */

const vGenerationInput = v.union(
  v.null(),
  v.object({
    profile: v.object({
      companyName: v.string(),
      industry: v.string(),
      description: v.string(),
      keyFeatures: v.array(v.string()),
      socialProof: v.array(v.string()),
    }),
    allowed: v.object({
      industries: v.array(v.string()),
      locations: v.array(v.string()),
      companyTypes: v.array(v.string()),
      companySizes: v.array(v.string()),
      excludeProfiles: v.array(v.string()),
    }),
  }),
);

type GenerationInput = Infer<typeof vGenerationInput>;

/**
 * The profile to read and the vocabularies to pick from, already shortlisted.
 *
 * `null` when the profile has gone — the org was cleared under a
 * scheduled run — which the action reports as a failure rather than asking
 * the model to invent a customer.
 */
export const generationInput = internalQuery({
  args: { orgId: v.id("orgs") },
  returns: vGenerationInput,
  handler: async (ctx, args) => {
    const profile = await getOrgProfile(ctx, args.orgId);
    if (profile === null) {
      return null;
    }
    const lists = (await readIcpOptionLists(ctx)) ?? EMPTY_ICP_OPTION_LISTS;
    const profileText = [
      profile.companyName,
      profile.industry,
      profile.description,
      ...profile.keyFeatures,
    ].join(" ");
    return {
      profile: {
        companyName: profile.companyName,
        industry: profile.industry,
        description: profile.description,
        keyFeatures: profile.keyFeatures,
        socialProof: profile.socialProof,
      },
      allowed: {
        industries: shortlistAllowedValues(
          lists.industries,
          profileText,
          ICP_INDUSTRY_CHOICES,
        ),
        // The broad regions are always offered; only the country tail is cut.
        locations: [
          ...lists.locations.slice(0, lists.locationRegionCount),
          ...shortlistAllowedValues(
            lists.locations.slice(lists.locationRegionCount),
            profileText,
            ICP_LOCATION_CHOICES,
          ),
        ],
        companyTypes: lists.companyTypes,
        companySizes: lists.companySizes.map((band) => band.label),
        excludeProfiles: lists.excludeProfiles.map((option) => option.label),
      },
    };
  },
});

/* ------------------------------------------------------------------ */
/* Mapping a refusal to one of our own codes                            */
/* ------------------------------------------------------------------ */

/**
 * Money and capacity keep their own code because the screen offers a different
 * next step for each; everything else that ends in "we could not write an ICP"
 * collapses into the sentence the user actually needs.
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
      return "invalid_response";
    case "unknown":
      return "unknown";
  }
}

/**
 * A THROWN failure: the request left us and nobody knows what it did, so the
 * hold parks as `uncertain` and a sweep owns it (PLAN §6). From the user's
 * side that is always the same fact — this run did not finish.
 */
const CODE_FOR_UNCERTAIN: OperationErrorCode = "provider_unavailable";

/* ------------------------------------------------------------------ */
/* The run                                                              */
/* ------------------------------------------------------------------ */

export const generate = internalAction({
  args: {
    orgId: v.id("orgs"),
    agentId: v.id("agents"),
    startedAt: v.number(),
    operationKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const fail = async (code: OperationErrorCode): Promise<null> => {
      await ctx.runMutation(internal.agents.icpResult.finishGeneration, {
        agentId: args.agentId,
        startedAt: args.startedAt,
        outcome: { state: "failed", code },
      });
      return null;
    };

    const input: GenerationInput = await ctx.runQuery(
      internal.agents.icpGeneration.generationInput,
      { orgId: args.orgId },
    );
    if (input === null) {
      return await fail("not_found");
    }

    let ai;
    try {
      ai = await runStructured(ctx, {
        orgId: args.orgId,
        action: "generate_icp",
        tier: "smart",
        system: ICP_GENERATION_SYSTEM,
        input: icpGenerationInput(input),
        result: vIcpGeneration,
        operationKey: args.operationKey,
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
      // Only reachable if this run's key were reused, which `icpModel.ts`
      // makes impossible — a replayed generation carries no object to save.
      return await fail("unknown");
    }
    if (ai.result.status === "invalid_response") {
      return await fail("invalid_response");
    }

    await ctx.runMutation(internal.agents.icpResult.finishGeneration, {
      agentId: args.agentId,
      startedAt: args.startedAt,
      outcome: { state: "ready", generation: ai.result.object },
    });
    return null;
  },
});
