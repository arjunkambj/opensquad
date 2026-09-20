/**
 * The paid half of the ICP, and the one write that ends a run (PLAN §3,
 * flow.html step 2).
 *
 * Scheduled by `agents.icp.startGeneration` and reachable from nowhere else.
 * The action never throws at its caller — the scheduler has no one to tell —
 * so it ends by reporting to `finishGeneration`, either with the ICP it
 * produced or with ONE mapped failure code, and a run always leaves the screen
 * in a state the user can act on.
 *
 * Every write is FENCED on `startedAt`: a Regenerate pressed while the first
 * run was still going must not have the older answer land on top of it, so a
 * report whose `startedAt` is not the one the agent is waiting for is dropped.
 */
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import {
  boundIcpGeneration,
  ICP_GENERATION_SYSTEM,
  icpGenerationInput,
  shortlistAllowedValues,
  vIcpGeneration,
} from "../ai/generateIcp";
import { runStructured } from "../ai/run";
import type { RefundReason } from "../billing/paidCall";
import { getWorkspaceProfile } from "../company/model";
import { vOperationErrorCode } from "../lib/validators";
import type { OperationErrorCode } from "../lib/validators";
import {
  boundedPainPoints,
  EMPTY_ICP_OPTION_LISTS,
  normalizeIcp,
  readIcpOptionLists,
  resolveGeneratedLabels,
} from "./icpModel";
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
 * `null` when the profile has gone — the workspace was cleared under a
 * scheduled run — which the action reports as a failure rather than asking
 * the model to invent a customer.
 */
export const generationInput = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: vGenerationInput,
  handler: async (ctx, args) => {
    const profile = await getWorkspaceProfile(ctx, args.workspaceId);
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
    workspaceId: v.id("workspaces"),
    agentId: v.id("agents"),
    startedAt: v.number(),
    operationKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const fail = async (code: OperationErrorCode): Promise<null> => {
      await ctx.runMutation(internal.agents.icpGeneration.finishGeneration, {
        agentId: args.agentId,
        startedAt: args.startedAt,
        outcome: { state: "failed", code },
      });
      return null;
    };

    const input: GenerationInput = await ctx.runQuery(
      internal.agents.icpGeneration.generationInput,
      { workspaceId: args.workspaceId },
    );
    if (input === null) {
      return await fail("not_found");
    }

    let ai;
    try {
      ai = await runStructured(ctx, {
        workspaceId: args.workspaceId,
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

    await ctx.runMutation(internal.agents.icpGeneration.finishGeneration, {
      agentId: args.agentId,
      startedAt: args.startedAt,
      outcome: { state: "ready", generation: ai.result.object },
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* The write that ends it                                               */
/* ------------------------------------------------------------------ */

/**
 * End the run `startedAt` began: write the ICP it produced, or record the
 * mapped failure code the screen turns into our own copy.
 *
 * Two things land, in two tables, because they came from one reading of the
 * profile: the seven ICP lists on the agent, and the customer's pain points on
 * the business profile, where dot 3 pre-fills its textarea from them. Pain
 * points are only written when the profile has none — they are the user's own
 * words once they have typed them (reference 05), and a Regenerate of the ICP
 * is not permission to overwrite a sentence they wrote.
 */
export const finishGeneration = internalMutation({
  args: {
    agentId: v.id("agents"),
    /** The run this report belongs to. */
    startedAt: v.number(),
    outcome: v.union(
      v.object({
        state: v.literal("ready"),
        generation: vIcpGeneration,
      }),
      v.object({
        state: v.literal("failed"),
        code: vOperationErrorCode,
      }),
    ),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("agents", args.agentId);
    if (agent === null) {
      return { applied: false };
    }
    const status = agent.icpGeneration;
    if (status?.state !== "generating" || status.startedAt !== args.startedAt) {
      // Superseded, or already reported. The newer run owns the row.
      return { applied: false };
    }

    const now = Date.now();
    if (args.outcome.state === "failed") {
      await ctx.db.patch("agents", args.agentId, {
        icpGeneration: { state: "failed", code: args.outcome.code, at: now },
        updatedAt: now,
      });
      return { applied: true };
    }

    const generated = boundIcpGeneration(args.outcome.generation);
    const lists = (await readIcpOptionLists(ctx)) ?? EMPTY_ICP_OPTION_LISTS;
    // Not strict: a model that misspelled one of six industries loses that
    // one chip, and the paid generation is still worth keeping.
    const icp = normalizeIcp({
      icp: resolveGeneratedLabels(generated, lists),
      options: lists,
      strict: false,
    });

    await ctx.db.patch("agents", args.agentId, {
      icp,
      icpGeneration: { state: "ready", generatedAt: now },
      // A bump, so anything queued against the old ICP is superseded rather
      // than run against a customer the agent no longer targets.
      revision: agent.revision + 1,
      updatedAt: now,
    });

    const painPoints = boundedPainPoints(generated.painPoints);
    if (painPoints.length > 0) {
      const profile = await getWorkspaceProfile(ctx, agent.workspaceId);
      if (profile !== null && profile.painPoints.trim().length === 0) {
        await ctx.db.patch("businessProfiles", profile._id, {
          painPoints,
          // The company form checks this before it saves, so an edit started
          // before this landed reloads instead of silently reverting it.
          version: profile.version + 1,
          updatedAt: now,
        });
      }
    }
    return { applied: true };
  },
});
