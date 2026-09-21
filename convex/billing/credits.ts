// The one credit number a member sees (PLAN §6 layer 1). Reads the
// org's lifetime `credits` bucket and nothing else: provider-unit
// buckets, their metric names and provider names never leave the server.
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  USAGE_PERIOD_LIFETIME,
  USAGE_SCOPE_ORG,
} from "../lib/validators";

export const vCreditBalance = v.object({
  /** Credits granted to the org for its lifetime. */
  granted: v.number(),
  /** Credits still spendable: granted − billed − pending. */
  remaining: v.number(),
  /** Credits held by steps whose outcome is not settled yet. */
  pending: v.number(),
});

/**
 * Credit balance for the sidebar block and every paid button. `null` means
 * the org has no credit grant, in which case every paid call refuses.
 */
export const balance = query({
  args: { orgId: v.id("orgs") },
  returns: v.union(vCreditBalance, v.null()),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const bucket = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_orgId_and_scopeKey_and_metric_and_periodKey",
        (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("scopeKey", USAGE_SCOPE_ORG)
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
