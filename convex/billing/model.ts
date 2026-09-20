/**
 * The usage ledger's buckets, and how a debit is TAKEN from one (PLAN §10
 * model layer). A `usageBuckets` row is one (workspaceId, scopeKey, metric,
 * periodKey) counter; a `usageReservations` row is one logical debit against
 * it. How a debit is then settled is `billing/transitions.ts`.
 *
 * This file decides nothing about WHEN to spend. It guarantees only that a
 * debit is taken inside the CALLER's transaction, so concurrent callers
 * serialize on the bucket row and cannot overspend.
 *
 * `billing/reservations.ts` exposes these as internal mutations for callers
 * that reserve from an action; `billing/reserve.ts` calls them directly,
 * because a wrapper that reserved through `ctx.runMutation` would not be one
 * transaction.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  boundedString,
  domainError,
  invalid,
  localDayKey,
  USAGE_PERIOD_LIFETIME,
  USAGE_SCOPE_WORKSPACE,
} from "../lib/validators";
import type { UsageMetric } from "../lib/validators";

/** The workspace-local day a daily bucket is keyed by (PLAN §6 "Ledger"). */
export function dailyPeriodKey(workspace: Doc<"workspaces">, at: number): string {
  return localDayKey(at, workspace.timezone);
}

/** The bucket for one (metric, period) of a workspace, or `null`. */
export async function findBucket(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  metric: UsageMetric,
  periodKey: string,
): Promise<Doc<"usageBuckets"> | null> {
  return await ctx.db
    .query("usageBuckets")
    .withIndex("by_workspaceId_and_scopeKey_and_metric_and_periodKey", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("scopeKey", USAGE_SCOPE_WORKSPACE)
        .eq("metric", metric)
        .eq("periodKey", periodKey),
    )
    .unique();
}

/** Spendable capacity: everything reserved, held or spent counts against it. */
export function bucketRemaining(bucket: Doc<"usageBuckets">): number {
  return (
    bucket.limit - bucket.reserved - bucket.committed - bucket.uncertain
  );
}

export type ReserveArgs = {
  workspaceId: Id<"workspaces">;
  scopeKey: string;
  metric: UsageMetric;
  periodKey: string;
  limit: number;
  operationKey: string;
  quantity?: number;
};

export type ReserveResult = {
  bucketId: Id<"usageBuckets">;
  reservationId: Id<"usageReservations">;
  /** `true` when this (workspaceId, operationKey, bucket) already held a live
   *  reservation — the recorded row is returned instead of double-debiting. */
  replayed: boolean;
};

/**
 * Reserve `quantity` from the bucket, creating the bucket on first use.
 *
 * The capacity check runs inside the CALLER's transaction, so concurrent
 * reserves serialize on the bucket row and cannot oversubscribe. `limit` is
 * refreshed on every call so a lowered policy applies immediately — except on
 * a replay, which returns above without touching the shared limit.
 */
export async function reserveInBucket(
  ctx: MutationCtx,
  args: ReserveArgs,
): Promise<ReserveResult> {
  const quantity = args.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw invalid("quantity must be a positive integer");
  }
  const scopeKey = boundedString(args.scopeKey, "scopeKey", { min: 1, max: 100 });
  const periodKey = boundedString(args.periodKey, "periodKey", {
    min: 1,
    max: 100,
  });
  const operationKey = boundedString(args.operationKey, "operationKey", {
    min: 1,
    max: 200,
  });
  if (!Number.isFinite(args.limit) || args.limit < 0) {
    throw invalid("limit must be a non-negative number");
  }

  const bucket = await ctx.db
    .query("usageBuckets")
    .withIndex("by_workspaceId_and_scopeKey_and_metric_and_periodKey", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("scopeKey", scopeKey)
        .eq("metric", args.metric)
        .eq("periodKey", periodKey),
    )
    .unique();

  const now = Date.now();
  let bucketId: Id<"usageBuckets">;
  if (bucket === null) {
    bucketId = await ctx.db.insert("usageBuckets", {
      workspaceId: args.workspaceId,
      scopeKey,
      metric: args.metric,
      periodKey,
      limit: args.limit,
      reserved: 0,
      committed: 0,
      uncertain: 0,
      updatedAt: now,
    });
  } else {
    bucketId = bucket._id;
  }

  const prior = await ctx.db
    .query("usageReservations")
    .withIndex("by_workspaceId_and_operationKey_and_bucketId", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("operationKey", operationKey)
        .eq("bucketId", bucketId),
    )
    .unique();
  if (prior !== null) {
    if (prior.state !== "reserved" && prior.state !== "uncertain") {
      throw domainError(
        "CONFLICT",
        `reservation for ${operationKey} is already ${prior.state}`,
      );
    }
    return { bucketId, reservationId: prior._id, replayed: true };
  }

  // Keep the cap current — a lowered policy applies to new reservations
  // immediately. Replayed calls return above without touching the bucket,
  // so a stale caller can never silently rewrite the shared limit.
  if (bucket !== null && bucket.limit !== args.limit) {
    await ctx.db.patch("usageBuckets", bucketId, {
      limit: args.limit,
      updatedAt: now,
    });
  }

  const effective = await ctx.db.get("usageBuckets", bucketId);
  if (effective === null) {
    throw domainError("NOT_FOUND", "usage bucket not found");
  }
  if (bucketRemaining(effective) < quantity) {
    throw domainError(
      "CONFLICT",
      `${args.metric} limit reached for period ${periodKey} ` +
        `(${effective.reserved + effective.committed + effective.uncertain}/${effective.limit})`,
    );
  }
  await ctx.db.patch("usageBuckets", bucketId, {
    reserved: effective.reserved + quantity,
    updatedAt: now,
  });
  const reservationId = await ctx.db.insert("usageReservations", {
    workspaceId: args.workspaceId,
    bucketId,
    operationKey,
    quantity,
    state: "reserved",
    createdAt: now,
    updatedAt: now,
  });
  return { bucketId, reservationId, replayed: false };
}

/** The lifetime `credits` bucket — the one number the member sees. */
export async function findCreditsBucket(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"usageBuckets"> | null> {
  return await findBucket(ctx, workspaceId, "credits", USAGE_PERIOD_LIFETIME);
}
