/**
 * The trial grant: the buckets an org is given when it is created
 * (PLAN §6 "Trial grant = creating the `lifetime` buckets with their limits
 * in the same mutation that creates the org").
 *
 * NO BUCKET, NO SPEND. The credit wrapper refuses outright when the lifetime
 * `credits` bucket is missing, so an org that somehow skipped the grant
 * cannot spend a thing — the grant is never implied and never lazy.
 *
 * Daily buckets are deliberately NOT granted here: their period key is the
 * org-local day, so they are created on first use by the reserve that
 * needs them, with the cap from `lib/limits.ts`.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  TRIAL_CREDIT_GRANT,
  TRIAL_METERED_METRICS,
  TRIAL_METRIC_CAPS,
} from "../lib/limits";
import { USAGE_PERIOD_LIFETIME, USAGE_SCOPE_ORG } from "../lib/validators";
import type { UsageMetric } from "../lib/validators";

/**
 * The one grant this identity has already been given, or `null`.
 *
 * TRIAL IDENTITY IS `tokenIdentifier` (`iss|sub`), not a verified email. A
 * person who signs in under a second auth `sub` is a second identity here and
 * would be granted again; that is accepted, because `MAX_TRIAL_ORGS` still
 * bounds the total and treating an email as an identity would trust a claim
 * the provider does not guarantee to be stable.
 */
export async function findTrialClaim(
  ctx: QueryCtx,
  identityKey: string,
): Promise<Doc<"trialGrants"> | null> {
  return await ctx.db
    .query("trialGrants")
    .withIndex("by_identityKey", (q) => q.eq("identityKey", identityKey))
    .first();
}

/**
 * Take this identity's one trial grant for `orgId`.
 *
 * The caller must have read `findTrialClaim` in the SAME transaction: that
 * read plus this write are what make the rule a constraint. Two parallel
 * `ensureOrg` calls for two organizations of one account both read the empty
 * range, and the loser's read range then contains the winner's insert, so
 * Convex conflicts it and retries it against the committed claim.
 */
export async function claimTrialGrant(
  ctx: MutationCtx,
  identityKey: string,
  orgId: Id<"orgs">,
): Promise<void> {
  await ctx.db.insert("trialGrants", {
    identityKey,
    orgId,
  });
}

/** One lifetime bucket the grant creates, with the limit it starts at. */
export type TrialBucketGrant = { metric: UsageMetric; limit: number };

/** The full lifetime grant for one trial org, in one list. */
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
 * Grant lifetime buckets in the transaction that creates the org and claims
 * its trial. The caller supplies the newly inserted org's id.
 */
export async function grantTrialBuckets(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
): Promise<void> {
  const now = Date.now();
  for (const grant of trialBucketGrants()) {
    await ctx.db.insert("usageBuckets", {
      orgId,
      scopeKey: USAGE_SCOPE_ORG,
      metric: grant.metric,
      periodKey: USAGE_PERIOD_LIFETIME,
      limit: grant.limit,
      reserved: 0,
      committed: 0,
      uncertain: 0,
      updatedAt: now,
    });
  }
}

/** The daily cap for a metered metric, for the reserve that creates its
 *  org-local-day bucket. */
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
