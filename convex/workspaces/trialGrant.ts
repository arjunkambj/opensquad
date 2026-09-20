/**
 * The trial grant, as functions the cutover can run.
 *
 * Workspace creation grants its buckets in its OWN transaction by calling the
 * model directly (`billing/trialBuckets.ts`), so a workspace never exists for
 * an instant without an allowance. These two functions exist for the data
 * migration: MIGRATION step H grants the workspaces that were created before
 * the credit model existed.
 *
 * Both are idempotent. A bucket that already exists keeps its counters — so
 * running the backfill twice, or over workspaces that were granted at
 * creation, hands out nothing extra.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { grantTrialBuckets } from "../billing/trialBuckets";
import { boundedInt, domainError } from "../lib/validators";
import { v } from "convex/values";

/** Grant one workspace its lifetime buckets. */
export const grantTrialBucketsForWorkspace = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ created: v.number() }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    return { created: await grantTrialBuckets(ctx, args.workspaceId) };
  },
});

const BACKFILL_BATCH_DEFAULT = 100;

/**
 * Grant every workspace that has none (MIGRATION step H1). Runs a page at a
 * time and schedules itself for the next one, so `'{}'` finishes the whole
 * table without holding a transaction open across it.
 */
export const backfillTrialBuckets = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    granted: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const numItems = boundedInt(
      args.batchSize ?? BACKFILL_BATCH_DEFAULT,
      "batchSize",
      { min: 1, max: 500 },
    );
    const page = await ctx.db.query("workspaces").paginate({
      cursor: args.cursor ?? null,
      numItems,
    });
    let granted = 0;
    for (const workspace of page.page) {
      if ((await grantTrialBuckets(ctx, workspace._id)) > 0) {
        granted += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.workspaces.trialGrant.backfillTrialBuckets,
        { cursor: page.continueCursor, batchSize: numItems },
      );
    }
    return {
      scanned: page.page.length,
      granted,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
