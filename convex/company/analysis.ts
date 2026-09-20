/**
 * The write half of website analysis: the one internal mutation that ends a
 * run (PLAN §5 "Onboarding edge cases").
 *
 * It is separate from `mutations.ts` because it is the only place that may
 * move `analysisStatus` out of `analyzing`, and because it is internal: the
 * browser starts a run and reads its status, and never writes either.
 *
 * Every write is FENCED on `startedAt`. A run that has been superseded — the
 * user changed the URL and pressed Analyze again while the first scrape was
 * still going — must not land its answer on top of the newer one, so a late
 * report whose `startedAt` is not the one the profile is waiting for is
 * dropped rather than applied.
 */
import { internalMutation } from "../_generated/server";
import { boundWebsiteAnalysis, vWebsiteAnalysis } from "../ai/analyzeWebsite";
import { vOperationErrorCode } from "../lib/validators";
import { v } from "convex/values";

/**
 * End the run `startedAt` began: either write the profile it produced, or
 * record the mapped failure code the screen turns into our own copy.
 *
 * Returns whether the report was applied, so the action's log says which of
 * the two happened rather than looking identical for a superseded run.
 */
export const finishAnalysis = internalMutation({
  args: {
    profileId: v.id("businessProfiles"),
    /** The run this report belongs to. */
    startedAt: v.number(),
    /** identityKey of the member who asked for the analysis. */
    updatedBy: v.string(),
    outcome: v.union(
      v.object({
        state: v.literal("ready"),
        analysis: vWebsiteAnalysis,
      }),
      v.object({
        state: v.literal("failed"),
        code: vOperationErrorCode,
      }),
    ),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get("businessProfiles", args.profileId);
    if (profile === null) {
      return { applied: false };
    }
    const status = profile.analysisStatus;
    if (status.state !== "analyzing" || status.startedAt !== args.startedAt) {
      // Superseded, or already reported. The newer run owns the row.
      return { applied: false };
    }

    const now = Date.now();
    if (args.outcome.state === "failed") {
      // The URL stays: the screen keeps it, so Retry needs no retyping, and
      // "Fill in manually" edits the same row (PLAN §5).
      await ctx.db.patch("businessProfiles", profile._id, {
        analysisStatus: { state: "failed", code: args.outcome.code, at: now },
        updatedAt: now,
      });
      return { applied: true };
    }

    const analysis = boundWebsiteAnalysis(args.outcome.analysis);
    await ctx.db.patch("businessProfiles", profile._id, {
      companyName: analysis.companyName,
      industry: analysis.industry,
      description: analysis.description,
      keyFeatures: analysis.keyFeatures,
      socialProof: analysis.socialProof,
      analysisStatus: { state: "ready", analyzedAt: now },
      // The free first run is spent HERE, on the success, and nowhere else.
      firstRunUsed: true,
      // A bump, so an edit the user started before the answer arrived fails
      // its version check and reloads instead of silently reverting it.
      version: profile.version + 1,
      updatedAt: now,
      updatedBy: args.updatedBy,
    });
    return { applied: true };
  },
});
