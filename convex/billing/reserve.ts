/**
 * The reserve half of `withCredits` (PLAN §6).
 *
 * ONE transaction takes everything a paid call may cost: the action's credit
 * price, its worst-case provider units in the workspace's lifetime AND daily
 * buckets, and the platform budget for the same units. Concurrent callers
 * serialize on those rows, so two calls can never overspend one allowance.
 *
 * Every layer is CHECKED before anything is written. A refusal therefore
 * leaves no half-taken reservation behind, and a caller that is over one cap
 * never briefly blocks another caller on a different one.
 *
 * It also writes the operation's audit row BEFORE the provider is contacted,
 * so there is no window in which a paid call exists with no record of it —
 * and reads that same row on a repeat, which is what makes a retry free.
 */
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ACTION_PRICES } from "../lib/limits";
import type { ProviderUnits, TrialMeteredMetric } from "../lib/limits";
import {
  computeResultDigest,
  domainError,
  USAGE_PERIOD_LIFETIME,
  USAGE_SCOPE_WORKSPACE,
} from "../lib/validators";
import type { ProviderKind } from "../lib/validators";
import {
  bucketRemaining,
  dailyPeriodKey,
  findBucket,
  findCreditsBucket,
  reserveInBucket,
} from "./model";
import {
  composeOperationKey,
  normalizeUnits,
  providerOfAction,
  toRefundReason,
  vPaidAction,
  vPaidOutcome,
  vProviderUnits,
  vRefundReason,
} from "./paidCall";
import type { RefundReason } from "./paidCall";
import {
  debitPlatformBudget,
  paidCallsPaused,
  platformBudgetHasRoom,
} from "./platformBudgets";
import { dailyMetricCap, lifetimeMetricCap } from "./trialBuckets";
import { v } from "convex/values";

const vBeginResult = v.union(
  v.object({
    decision: v.literal("execute"),
    operationId: v.id("providerOperations"),
    operationKey: v.string(),
    credits: v.number(),
    providerUnits: vProviderUnits,
  }),
  v.object({
    decision: v.literal("refused"),
    operationKey: v.string(),
    reason: vRefundReason,
  }),
  v.object({
    decision: v.literal("replay"),
    operationId: v.id("providerOperations"),
    operationKey: v.string(),
    outcome: vPaidOutcome,
    credits: v.number(),
    providerUnits: vProviderUnits,
    resultRef: v.optional(v.string()),
    reason: v.optional(vRefundReason),
  }),
);

export type BeginResult =
  | {
      decision: "execute";
      operationId: Id<"providerOperations">;
      operationKey: string;
      credits: number;
      providerUnits: ProviderUnits;
    }
  | { decision: "refused"; operationKey: string; reason: RefundReason }
  | {
      decision: "replay";
      operationId: Id<"providerOperations">;
      operationKey: string;
      outcome: "billed" | "refunded" | "uncertain";
      credits: number;
      providerUnits: ProviderUnits;
      resultRef?: string;
      reason?: RefundReason;
    };

/** How much of `metric` this workspace could still reserve in `periodKey`,
 *  measured against the CURRENT policy cap, which the reserve refreshes. */
async function availableInBucket(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  metric: TrialMeteredMetric,
  periodKey: string,
  policyLimit: number,
): Promise<number> {
  const bucket = await findBucket(ctx, workspaceId, metric, periodKey);
  if (bucket === null) {
    return policyLimit;
  }
  return policyLimit - bucket.reserved - bucket.committed - bucket.uncertain;
}

/**
 * Has this workspace ever been BILLED for this action? The first-run-free
 * actions of PLAN §6 are free exactly once, and a free run records a
 * commit-settled operation, so the second run is priced from the same fact.
 */
async function actionAlreadyBilled(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  provider: ProviderKind,
  action: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query("providerOperations")
    .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
      q
        .eq("workspaceId", workspaceId)
        .eq("provider", provider)
        .gte("operationKey", `${action}:`)
        .lt("operationKey", `${action}:\uffff`),
    )
    .take(256);
  return rows.some((row) => row.settlement === "commit");
}

/**
 * Reserve everything the call may cost, or refuse — atomically, and in that
 * order: every layer is CHECKED before anything is written, so a refusal
 * leaves no half-taken reservation behind and a caller that is over one cap
 * never briefly blocks another.
 */
export const beginPaidCall = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    action: vPaidAction,
    operationKey: v.string(),
    worstCaseProviderUnits: v.optional(vProviderUnits),
  },
  returns: vBeginResult,
  handler: async (ctx, args): Promise<BeginResult> => {
    const price = ACTION_PRICES[args.action];
    const provider = providerOfAction(args.action);
    const operationKey = composeOperationKey(args.action, args.operationKey);
    const units = normalizeUnits(args.worstCaseProviderUnits);
    const requestDigest = await computeResultDigest({
      provider,
      action: args.action,
      operationKey,
      units,
    });

    // 1. A settled — or still in-flight — operation is replayed, never re-bought.
    const existing = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("provider", provider)
          .eq("operationKey", operationKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestDigest !== requestDigest) {
        throw domainError(
          "CONFLICT",
          "operationKey was already used with different arguments",
        );
      }
      return await replayOf(ctx, existing);
    }

    // 2. The kill switch, before a single read of the workspace's money.
    if (paidCallsPaused()) {
      return { decision: "refused", operationKey, reason: "kill_switch" };
    }

    const workspace = await ctx.db.get("workspaces", args.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "organization not found");
    }

    // 3. No grant, no spend — the trial buckets are made with the workspace.
    const creditsBucket = await findCreditsBucket(ctx, args.workspaceId);
    if (creditsBucket === null) {
      return { decision: "refused", operationKey, reason: "no_credit_grant" };
    }

    const credits =
      price.firstRunFree &&
      !(await actionAlreadyBilled(ctx, args.workspaceId, provider, args.action))
        ? 0
        : price.credits;

    // 4. Check every layer. Nothing is written until all of them pass.
    if (credits > 0 && bucketRemaining(creditsBucket) < credits) {
      return {
        decision: "refused",
        operationKey,
        reason: "insufficient_credits",
      };
    }
    const now = Date.now();
    const dayKey = dailyPeriodKey(workspace, now);
    for (const [key, quantity] of Object.entries(units)) {
      const metric = key as TrialMeteredMetric;
      const lifetime = await availableInBucket(
        ctx,
        args.workspaceId,
        metric,
        USAGE_PERIOD_LIFETIME,
        lifetimeMetricCap(metric),
      );
      const daily = await availableInBucket(
        ctx,
        args.workspaceId,
        metric,
        dayKey,
        dailyMetricCap(metric),
      );
      if (lifetime < quantity || daily < quantity) {
        return {
          decision: "refused",
          operationKey,
          reason: "trial_limit_reached",
        };
      }
      if (!(await platformBudgetHasRoom(ctx, metric, quantity, now))) {
        return {
          decision: "refused",
          operationKey,
          reason: "platform_capacity",
        };
      }
    }

    // 5. Take it all, in this one transaction.
    const reservationIds: Id<"usageReservations">[] = [];
    if (credits > 0) {
      const reserved = await reserveInBucket(ctx, {
        workspaceId: args.workspaceId,
        scopeKey: USAGE_SCOPE_WORKSPACE,
        metric: "credits",
        periodKey: USAGE_PERIOD_LIFETIME,
        // The grant itself is the ceiling; a reserve never rewrites it.
        limit: creditsBucket.limit,
        operationKey,
        quantity: credits,
      });
      reservationIds.push(reserved.reservationId);
    }
    for (const [key, quantity] of Object.entries(units)) {
      const metric = key as TrialMeteredMetric;
      for (const [periodKey, limit] of [
        [USAGE_PERIOD_LIFETIME, lifetimeMetricCap(metric)],
        [dayKey, dailyMetricCap(metric)],
      ] as const) {
        const reserved = await reserveInBucket(ctx, {
          workspaceId: args.workspaceId,
          scopeKey: USAGE_SCOPE_WORKSPACE,
          metric,
          periodKey,
          limit,
          operationKey,
          quantity,
        });
        reservationIds.push(reserved.reservationId);
      }
      await debitPlatformBudget(ctx, metric, quantity, now);
    }

    // 6. One audit row per paid call, written BEFORE the provider is
    //    contacted, so no paid call exists without a record of it.
    const operationId = await ctx.db.insert("providerOperations", {
      workspaceId: args.workspaceId,
      provider,
      operationKey,
      requestDigest,
      reservationIds,
      state: "requested",
      createdAt: now,
      updatedAt: now,
    });
    return {
      decision: "execute",
      operationId,
      operationKey,
      credits,
      providerUnits: units,
    };
  },
});

/** What a repeat of an already-recorded operation gets back. */
async function replayOf(
  ctx: MutationCtx,
  operation: Doc<"providerOperations">,
): Promise<BeginResult> {
  const outcome =
    operation.settlement === "commit"
      ? ("billed" as const)
      : operation.settlement === "release"
        ? ("refunded" as const)
        : // `markUncertain`, or still in flight: either way the honest answer
          // is that the money is held and the outcome is not known yet.
          ("uncertain" as const);
  const amounts = await settledAmounts(ctx, operation);
  const resultRef =
    operation.resultRef?.kind === "inline" &&
    typeof operation.resultRef.value === "string"
      ? operation.resultRef.value
      : undefined;
  return {
    decision: "replay",
    operationId: operation._id,
    operationKey: operation.operationKey,
    outcome,
    credits: amounts.credits,
    providerUnits: amounts.units,
    ...(resultRef !== undefined ? { resultRef } : {}),
    ...(outcome === "refunded"
      ? { reason: toRefundReason(operation.error?.code) }
      : {}),
  };
}

/** Credits and units this operation actually holds or spent, read off the
 *  reservations it owns. A metric holds a lifetime and a daily row of equal
 *  size, so the metric's amount is the larger, never their sum. */
async function settledAmounts(
  ctx: QueryCtx,
  operation: Doc<"providerOperations">,
): Promise<{ credits: number; units: ProviderUnits }> {
  const units: ProviderUnits = {};
  let credits = 0;
  for (const reservationId of operation.reservationIds) {
    const reservation = await ctx.db.get("usageReservations", reservationId);
    if (reservation === null || reservation.state === "released") {
      continue;
    }
    const bucket = await ctx.db.get("usageBuckets", reservation.bucketId);
    if (bucket === null) {
      continue;
    }
    if (bucket.metric === "credits") {
      credits = Math.max(credits, reservation.quantity);
      continue;
    }
    const metric = bucket.metric as TrialMeteredMetric;
    units[metric] = Math.max(units[metric] ?? 0, reservation.quantity);
  }
  return { credits, units };
}
