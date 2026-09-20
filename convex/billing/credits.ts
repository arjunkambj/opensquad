// The one credit number a member sees (PLAN §6 layer 1). Reads the
// workspace's lifetime `credits` bucket and nothing else: provider-unit
// buckets, their metric names and provider names never leave the server.
import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import {
  USAGE_PERIOD_LIFETIME,
  USAGE_SCOPE_WORKSPACE,
  vUsageMetric,
} from "../lib/validators";

export const vCreditBalance = v.object({
  /** Credits granted to the workspace for its lifetime. */
  granted: v.number(),
  /** Credits still spendable: granted − billed − pending. */
  remaining: v.number(),
  /** Credits held by steps whose outcome is not settled yet. */
  pending: v.number(),
});

/**
 * Credit balance for the sidebar block and every paid button. `null` means
 * the workspace has no credit grant, in which case every paid call refuses.
 */
export const balance = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(vCreditBalance, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const bucket = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("scopeKey", USAGE_SCOPE_WORKSPACE)
            .eq("metric", "credits")
            .eq("periodKey", USAGE_PERIOD_LIFETIME),
      )
      .unique();
    if (bucket === null) {
      return null;
    }
    const pending = bucket.reserved + bucket.uncertain;
    return {
      granted: bucket.limit,
      remaining: Math.max(0, bucket.limit - bucket.committed - pending),
      pending,
    };
  },
});

/**
 * The operator's view of one workspace's whole allowance — every bucket, its
 * metric and its counters.
 *
 * INTERNAL on purpose: it answers "why is this member's paid button
 * disabled" and "did that sweep settle what it should have", and it names
 * provider metrics, which no client payload may (PLAN §4). It is also what
 * makes the ledger checkable from the CLI without a test-only endpoint
 * existing in the tree.
 */
export const ledgerSnapshot = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({
    credits: v.union(vCreditBalance, v.null()),
    buckets: v.array(
      v.object({
        metric: vUsageMetric,
        periodKey: v.string(),
        limit: v.number(),
        reserved: v.number(),
        committed: v.number(),
        uncertain: v.number(),
        remaining: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const buckets = await ctx.db
      .query("usageBuckets")
      .withIndex("by_workspaceId_and_scopeKey_and_metric_and_periodKey", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .collect();
    const creditsBucket = buckets.find(
      (bucket) =>
        bucket.metric === "credits" &&
        bucket.periodKey === USAGE_PERIOD_LIFETIME,
    );
    const pending =
      creditsBucket === undefined
        ? 0
        : creditsBucket.reserved + creditsBucket.uncertain;
    return {
      credits:
        creditsBucket === undefined
          ? null
          : {
              granted: creditsBucket.limit,
              remaining: Math.max(
                0,
                creditsBucket.limit - creditsBucket.committed - pending,
              ),
              pending,
            },
      buckets: buckets.map((bucket) => ({
        metric: bucket.metric,
        periodKey: bucket.periodKey,
        limit: bucket.limit,
        reserved: bucket.reserved,
        committed: bucket.committed,
        uncertain: bucket.uncertain,
        remaining:
          bucket.limit - bucket.reserved - bucket.committed - bucket.uncertain,
      })),
    };
  },
});
