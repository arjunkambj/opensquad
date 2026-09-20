/** Owner/operator-safe reads over the usage ledger. */
import { query } from "../_generated/server";
import { requireWorkspaceEditor } from "../lib/auth";
import { boundedLimit, vUsageMetric } from "../lib/validators";
import { usageBucketFields, usageReservationFields } from "../schema";
import { v } from "convex/values";

export const vUsageBucketDoc = v.object({
  _id: v.id("usageBuckets"),
  _creationTime: v.number(),
  ...usageBucketFields,
});

export const vUsageReservationDoc = v.object({
  _id: v.id("usageReservations"),
  _creationTime: v.number(),
  ...usageReservationFields,
});

export const vUsageBucketSummary = v.object({
  bucketId: v.id("usageBuckets"),
  scopeKey: v.string(),
  metric: vUsageMetric,
  periodKey: v.string(),
  limit: v.number(),
  reserved: v.number(),
  committed: v.number(),
  uncertain: v.number(),
  /** limit − reserved − committed − uncertain (may be negative if the
   *  limit was lowered after debits — new reservations then refuse). */
  remaining: v.number(),
  updatedAt: v.number(),
});

/**
 * Usage summary — owner/operator only (§5 "Owner/operator-safe summary
 * only"). Returns one entry per bucket, bounded.
 */
export const summary = query({
  args: {
    workspaceId: v.id("workspaces"),
    metric: v.optional(vUsageMetric),
    limit: v.optional(v.number()),
  },
  returns: v.array(vUsageBucketSummary),
  handler: async (ctx, args) => {
    await requireWorkspaceEditor(ctx, args.workspaceId);
    const limit = boundedLimit(args.limit);
    const buckets = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) => q.eq("workspaceId", args.workspaceId),
      )
      .collect();
    return buckets
      .filter((bucket) => args.metric === undefined || bucket.metric === args.metric)
      .slice(0, limit)
      .map((bucket) => ({
        bucketId: bucket._id,
        scopeKey: bucket.scopeKey,
        metric: bucket.metric,
        periodKey: bucket.periodKey,
        limit: bucket.limit,
        reserved: bucket.reserved,
        committed: bucket.committed,
        uncertain: bucket.uncertain,
        remaining:
          bucket.limit - bucket.reserved - bucket.committed - bucket.uncertain,
        updatedAt: bucket.updatedAt,
      }));
  },
});
