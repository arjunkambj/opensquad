/**
 * The one write that ends an ICP generation (PLAN §5 "Onboarding edge cases").
 *
 * It is separate from `icpGeneration.ts` because it is the only place that may
 * move `icpGeneration` out of `generating`, and because it is internal: the
 * browser starts a run and reads its status, and never writes either.
 *
 * Every write is FENCED on `startedAt`. A run that has been superseded — the
 * user pressed Regenerate while the first one was still going — must not land
 * its answer on top of the newer one, so a late report whose `startedAt` is
 * not the one the agent is waiting for is dropped rather than applied.
 */
import { internalMutation } from "../_generated/server";
import { boundIcpGeneration, vIcpGeneration } from "../ai/generateIcp";
import { getOrgProfile } from "../company/model";
import { vOperationErrorCode } from "../lib/validators";
import {
  boundedPainPoints,
  normalizeIcp,
  resolveGeneratedLabels,
} from "./icpModel";
import { EMPTY_ICP_OPTION_LISTS, readIcpOptionLists } from "./icpVocabulary";
import { v } from "convex/values";

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
      const profile = await getOrgProfile(ctx, agent.orgId);
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
