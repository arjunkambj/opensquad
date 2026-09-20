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

/** A neutral refusal: the client says "at capacity today", never which
 *  provider ran out or how much of it is left. `metric` names no provider
 *  (PLAN §4) and the message carries no counts. */
function platformCapacityError(metric: TrialMeteredMetric) {
  return domainError(
    "PLATFORM_CAPACITY",
    `platform budget for ${metric} is spent for this period`,
  );
}

/* ------------------------------------------------------------------ */
/* Signup capacity                                                     */
/* ------------------------------------------------------------------ */

export function maxTrialOrgs(): number {
  return readIntEnv(MAX_TRIAL_ORGS_ENV, MAX_TRIAL_ORGS_DEFAULT);
}

/**
 * Is there room for one more trial org?
 *
 * Reads at most `max + 1` rows and answers a boolean: the exact number of
 * tenants is not something a signed-out visitor — or a member — gets to
 * learn from the waitlist screen.
 */
export async function trialCapacityOpen(ctx: QueryCtx): Promise<boolean> {
  const max = maxTrialOrgs();
  if (max === 0) {
    return false;
  }
  const rows = await ctx.db.query("orgs").take(max + 1);
  return rows.length <= max;
}
