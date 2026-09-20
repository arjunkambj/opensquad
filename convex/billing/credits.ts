// The one credit number a member sees (PLAN §6 layer 1). Reads the
// workspace's lifetime `credits` bucket and nothing else: provider-unit
// buckets, their metric names and provider names never leave the server.
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import { USAGE_PERIOD_LIFETIME, USAGE_SCOPE_WORKSPACE } from "../lib/validators";

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
