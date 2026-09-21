/**
 * Platform-wide circuit breakers (PLAN §6): the kill switch, the per-provider
 * budgets that bound OUR bill whatever any one org does, and the signup
 * capacity that stops new trials before they exist.
 *
 * A `platformBudgets` row is `{ provider, periodKey, limit, used }`, unique
 * per (provider, periodKey) and created lazily from the deployment env the
 * first time that period is debited. The credit wrapper debits it in the SAME
 * transaction as the org buckets, so the worst case per day is a number
 * we chose rather than a function of how many people sign up.
 *
 * Periods are UTC on purpose: a platform budget is our invoice, not any one
 * org's local day. A settle recomputes the period from the operation's
 * own `createdAt`, so a refund after midnight credits the period that was
 * actually debited.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { domainError } from "../lib/validators";
import {
  MAX_TRIAL_ORGS_DEFAULT,
  MAX_TRIAL_ORGS_ENV,
  PLATFORM_BUDGETS,
  PLATFORM_PAUSED_ENV,
  readBooleanEnv,
  readIntEnv,
} from "../lib/limits";
import type { PlatformBudgetPolicy, TrialMeteredMetric } from "../lib/limits";

/** The kill switch: `PLATFORM_PAUSED=true` stops every paid call instantly. */
export function paidCallsPaused(): boolean {
  return readBooleanEnv(PLATFORM_PAUSED_ENV);
}

/** `<prefix>:<UTC day|month>` — the period this metric's budget resets on. */
export function platformPeriodKey(
  policy: PlatformBudgetPolicy,
  at: number,
): string {
  const iso = new Date(at).toISOString();
  const period = policy.periodKind === "utc_month" ? iso.slice(0, 7) : iso.slice(0, 10);
  return `${policy.periodPrefix}:${period}`;
}

/** The configured ceiling for this budget, from deployment env. */
export function platformBudgetLimit(policy: PlatformBudgetPolicy): number {
  return readIntEnv(policy.envName, policy.defaultLimit);
}

async function findBudgetRow(
  ctx: QueryCtx,
  policy: PlatformBudgetPolicy,
  periodKey: string,
): Promise<Doc<"platformBudgets"> | null> {
  return await ctx.db
    .query("platformBudgets")
    .withIndex("by_provider_and_periodKey", (q) =>
      q.eq("provider", policy.provider).eq("periodKey", periodKey),
    )
    .unique();
}

/**
 * Would `amount` of this metric still fit in the platform budget for the
 * period containing `at`? Read-only, so the wrapper can decide to refuse
 * before it writes anything at all.
 */
export async function platformBudgetHasRoom(
  ctx: QueryCtx,
  metric: TrialMeteredMetric,
  amount: number,
  at: number,
): Promise<boolean> {
  if (amount <= 0) {
    return true;
  }
  const policy = PLATFORM_BUDGETS[metric];
  const row = await findBudgetRow(ctx, policy, platformPeriodKey(policy, at));
  const used = row?.used ?? 0;
  return used + amount <= platformBudgetLimit(policy);
}

/**
 * Debit the platform budget, creating the period's row on first use. Throws
 * only if the caller skipped `platformBudgetHasRoom`; the wrapper checks
 * every layer first, so reaching the refusal here means a concurrent debit
 * took the last of the budget — and rolling the whole transaction back is
 * exactly right.
 */
export async function debitPlatformBudget(
  ctx: MutationCtx,
  metric: TrialMeteredMetric,
  amount: number,
  at: number,
): Promise<void> {
  if (amount <= 0) {
    return;
  }
  const policy = PLATFORM_BUDGETS[metric];
  const periodKey = platformPeriodKey(policy, at);
  const limit = platformBudgetLimit(policy);
  const row = await findBudgetRow(ctx, policy, periodKey);
  const now = Date.now();
  if (row === null) {
    if (amount > limit) {
      throw platformCapacityError(metric);
    }
    await ctx.db.insert("platformBudgets", {
      provider: policy.provider,
      periodKey,
      limit,
      used: amount,
      updatedAt: now,
    });
    return;
  }
  if (row.used + amount > limit) {
    throw platformCapacityError(metric);
  }
  await ctx.db.patch("platformBudgets", row._id, {
    // Keep the ceiling current so a retuned env applies without a backfill.
    limit,
    used: row.used + amount,
    updatedAt: now,
  });
}

/**
 * Hand budget back: the provider charged less than the worst case, or the
 * call was refunded in full. Never below zero — an over-credit would hand out
 * capacity we never had.
 */
export async function creditPlatformBudget(
  ctx: MutationCtx,
  metric: TrialMeteredMetric,
  amount: number,
  at: number,
): Promise<void> {
  if (amount <= 0) {
    return;
  }
  const policy = PLATFORM_BUDGETS[metric];
  const row = await findBudgetRow(ctx, policy, platformPeriodKey(policy, at));
  if (row === null) {
    return;
  }
  await ctx.db.patch("platformBudgets", row._id, {
    used: Math.max(0, row.used - amount),
    updatedAt: Date.now(),
  });
}

/**
 * What a metric is called in a message a CLIENT may read.
 *
 * The metric names are server vocabulary and two of them carry the lead-data
 * provider's name, which nothing client-visible may say (PLAN §4
 * "White-label"). This maps each one to the capability the user recognises
 * before the refusal can leave the server.
 */
const CAPACITY_LABELS: Record<TrialMeteredMetric, string> = {
  enrich_credits: "finding contact details",
  enrich_searches: "lead search",
  ai_calls: "writing and scoring",
  scrapes: "web research",
};

/** A neutral refusal: the client says "at capacity", never which provider ran
 *  out or how much of it is left. The message names no provider (PLAN §4) and
 *  carries no counts. */
function platformCapacityError(metric: TrialMeteredMetric) {
  return domainError(
    "PLATFORM_CAPACITY",
    `${CAPACITY_LABELS[metric]} is at capacity for now`,
  );
}

/* ------------------------------------------------------------------ */
/* The platform breaker                                                */
/* ------------------------------------------------------------------ */

/**
 * The marker added to a budget's `used` to trip it. Far above any real usage,
 * so "tripped" is unambiguous and removing it restores the true figure rather
 * than guessing at it.
 *
 * Exported because it is the CONVENTION, not one watchdog's private constant:
 * every breaker in the product trips the same way, on the same rows
 * `withCredits` already checks, with the same size of marker.
 */
export const BREAKER_MARKER_UNITS = 1_000_000_000;

/**
 * Trip or release the platform breaker for ONE metric.
 *
 * Why a marker rather than a flag: `PLATFORM_PAUSED` is a deployment env var,
 * which no Convex function can set, and an operator resetting a breaker must
 * not need a deploy either. So a breaker is expressed in the rows the credit
 * wrapper already reads — `platformBudgets` for the period — by adding a
 * marker far larger than any real usage to `used`. Every paid call on that
 * metric then refuses with the neutral `PLATFORM_CAPACITY` code for everyone,
 * while the genuine usage underneath is preserved: releasing subtracts
 * exactly the marker back out.
 *
 * A budget resets on its own period (UTC day for credits, UTC month for
 * searches), so a trip only marks the period it was taken in — and the
 * watchdog re-trips the new period on its next pass if the condition holds.
 * That is deliberate: a breaker that outlived its cause would need a deploy
 * to clear.
 *
 * Idempotent in both directions: a second trip adds nothing and a release
 * with no marker present changes nothing, so a cron that keeps finding the
 * same answer keeps writing the same state. Returns whether the row moved.
 */
export async function setPlatformBreaker(
  ctx: MutationCtx,
  metric: TrialMeteredMetric,
  tripped: boolean,
): Promise<boolean> {
  const policy = PLATFORM_BUDGETS[metric];
  const now = Date.now();
  const periodKey = platformPeriodKey(policy, now);
  const row = await findBudgetRow(ctx, policy, periodKey);
  if (row === null) {
    if (!tripped) {
      return false;
    }
    await ctx.db.insert("platformBudgets", {
      provider: policy.provider,
      periodKey,
      limit: platformBudgetLimit(policy),
      used: BREAKER_MARKER_UNITS,
      updatedAt: now,
    });
    return true;
  }
  const marked = row.used >= BREAKER_MARKER_UNITS;
  if (marked === tripped) {
    return false;
  }
  await ctx.db.patch("platformBudgets", row._id, {
    used: tripped
      ? row.used + BREAKER_MARKER_UNITS
      : Math.max(0, row.used - BREAKER_MARKER_UNITS),
    updatedAt: now,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Signup capacity                                                     */
/* ------------------------------------------------------------------ */

export function maxTrialOrgs(): number {
  return readIntEnv(MAX_TRIAL_ORGS_ENV, MAX_TRIAL_ORGS_DEFAULT);
}

/**
 * Is there room for one more trial GRANT?
 *
 * It counts `trialGrants`, not `orgs`. The cap bounds how many trials we
 * FUND: an org created with no grant can spend nothing (every paid call
 * refuses with `NO_CREDIT_GRANT`), so counting rows in `orgs` would let an
 * account mint no-grant organizations until the platform waitlisted real
 * users — the opposite of what the cap is for.
 *
 * Reads at most `max` rows and answers a boolean: the exact number of
 * tenants is not something a signed-out visitor — or a member — gets to
 * learn from the waitlist screen. `max` claims present means the cap is
 * REACHED, so the answer is `length < max`, not `<=`.
 *
 * The read range is also the serialisation point. Below the cap the range
 * covers every claim there is, so a concurrent grant's insert falls inside it
 * and conflicts this transaction, which then retries against the committed
 * count.
 */
export async function trialCapacityOpen(ctx: QueryCtx): Promise<boolean> {
  const max = maxTrialOrgs();
  if (max === 0) {
    return false;
  }
  const claims = await ctx.db.query("trialGrants").take(max);
  return claims.length < max;
}
