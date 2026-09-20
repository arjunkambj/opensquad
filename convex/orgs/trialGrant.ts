/**
 * The trial grant, as functions the cutover can run.
 *
 * `ensureOrg` grants a FIRST org its buckets in its own transaction by
 * calling the model directly (`billing/trialBuckets.ts`). These two functions
 * exist for the data migration instead: MIGRATION step H grants the orgs that
 * were created before the credit model existed.
 *
 * They deliberately do NOT re-apply the one-grant-per-user rule `ensureOrg`
 * enforces — that rule stops a user minting allowances by creating
 * organizations, and these are run by an operator over rows that already
 * exist, one allowance each, once.
 *
 * Both are idempotent. A bucket that already exists keeps its counters — so
 * running the backfill twice, or over orgs that were granted at creation,
 * hands out nothing extra.
 */
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { grantTrialBuckets } from "../billing/trialBuckets";
import { boundedInt, domainError } from "../lib/validators";
import { v } from "convex/values";

/** Grant one org its lifetime buckets. */
export const grantTrialBucketsForOrg = internalMutation({
  args: { orgId: v.id("orgs") },
  returns: v.object({ created: v.number() }),
  handler: async (ctx, args) => {
    const org = await ctx.db.get("orgs", args.orgId);
    if (org === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }
    return { created: await grantTrialBuckets(ctx, args.orgId) };
  },
});

const BACKFILL_BATCH_DEFAULT = 100;

/**
 * Grant every org that has none (MIGRATION step H1). Runs a page at a
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
    const page = await ctx.db.query("orgs").paginate({
      cursor: args.cursor ?? null,
      numItems,
    });
    let granted = 0;
    for (const org of page.page) {
      if ((await grantTrialBuckets(ctx, org._id)) > 0) {
        granted += 1;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.orgs.trialGrant.backfillTrialBuckets,
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
