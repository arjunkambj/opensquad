/**
 * The trial grant: the buckets a workspace is given when it is created
 * (PLAN §6 "Trial grant = creating the `lifetime` buckets with their limits
 * in the same mutation that creates the workspace").
 *
 * NO BUCKET, NO SPEND. The credit wrapper refuses outright when the lifetime
 * `credits` bucket is missing, so a workspace that somehow skipped the grant
 * cannot spend a thing — the grant is never implied and never lazy.
 *
 * Daily buckets are deliberately NOT granted here: their period key is the
 * workspace-local day, so they are created on first use by the reserve that
 * needs them, with the cap from `lib/limits.ts`.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  TRIAL_CREDIT_GRANT,
  TRIAL_METERED_METRICS,
  TRIAL_METRIC_CAPS,
} from "../lib/limits";
import { USAGE_PERIOD_LIFETIME, USAGE_SCOPE_WORKSPACE } from "../lib/validators";
import type { UsageMetric } from "../lib/validators";
import { findBucket } from "./model";

/** One lifetime bucket the grant creates, with the limit it starts at. */
export type TrialBucketGrant = { metric: UsageMetric; limit: number };

/** The full lifetime grant for one trial workspace, in one list. */
export function trialBucketGrants(): TrialBucketGrant[] {
  return [
    { metric: "credits", limit: TRIAL_CREDIT_GRANT },
    ...TRIAL_METERED_METRICS.map((metric) => ({
      metric,
      limit: TRIAL_METRIC_CAPS[metric].lifetime,
    })),
  ];
}

/**
 * Grant the lifetime buckets to one workspace. Idempotent: a bucket that
 * already exists keeps its counters and only has its limit refreshed, so
 * running this twice — or backfilling a workspace that was half-granted —
 * can never hand out a second allowance.
 *
 * Returns the number of buckets it had to create, which is what makes a
 * backfill's progress report honest.
 */
export async function grantTrialBuckets(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<number> {
  const now = Date.now();
  let created = 0;
  for (const grant of trialBucketGrants()) {
    const existing = await findBucket(
      ctx,
      workspaceId,
      grant.metric,
      USAGE_PERIOD_LIFETIME,
    );
    if (existing !== null) {
      if (existing.limit !== grant.limit) {
        await ctx.db.patch("usageBuckets", existing._id, {
          limit: grant.limit,
          updatedAt: now,
        });
      }
      continue;
    }
    await ctx.db.insert("usageBuckets", {
      workspaceId,
      scopeKey: USAGE_SCOPE_WORKSPACE,
      metric: grant.metric,
      periodKey: USAGE_PERIOD_LIFETIME,
      limit: grant.limit,
      reserved: 0,
      committed: 0,
      uncertain: 0,
      updatedAt: now,
    });
    created += 1;
  }
  return created;
}

/** The daily cap for a metered metric, for the reserve that creates its
 *  workspace-local-day bucket. */
export function dailyMetricCap(
  metric: (typeof TRIAL_METERED_METRICS)[number],
): number {
  return TRIAL_METRIC_CAPS[metric].daily;
}

/** The lifetime cap for a metered metric — the number the grant above uses
 *  and the reserve refreshes, so a retune applies without a backfill. */
export function lifetimeMetricCap(
  metric: (typeof TRIAL_METERED_METRICS)[number],
): number {
  return TRIAL_METRIC_CAPS[metric].lifetime;
}
