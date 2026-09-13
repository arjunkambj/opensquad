/**
 * Usage accounting (architecture §4.4, §9 "Billable/limited resources are
 * debited inside transactions").
 *
 * A `usageBuckets` row is one (workspaceId, scopeKey, metric, periodKey)
 * counter; `usageReservations` rows track one logical debit's lifecycle —
 * `reserved` at intent, then exactly one of `committed` (accepted send),
 * `released` (definitively failed/cancelled before any provider effect) or
 * `uncertain` (unknown outcome — capacity stays blocked until reconciled).
 *
 * Sends are bucketed by the workspace-local day (`localDayKey(now,
 * workspace.timezone)`), enforced inside the reserving transaction so
 * concurrent sends cannot oversubscribe the daily limit.
 *
 * The runtime transport tables (runtimeConnections, workerRequests, …) are
 * P07's — not here.
 */
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceEditor } from "./lib/auth";
import {
  boundedString,
  domainError,
  invalid,
  vUsageMetric,
} from "./lib/validators";
import type { UsageReservationState } from "./lib/validators";
import { usageBucketFields, usageReservationFields } from "./schema";

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

/* ------------------------------------------------------------------ */
/* Owner/operator-safe summary                                          */
/* ------------------------------------------------------------------ */

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
    const limit = Math.min(args.limit ?? 100, 500);
    const buckets = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) => q.eq("workspaceId", args.workspaceId),
      )
      .take(limit);
    return buckets
      .filter((bucket) => args.metric === undefined || bucket.metric === args.metric)
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

/* ------------------------------------------------------------------ */
/* Internal reservation lifecycle                                       */
/* ------------------------------------------------------------------ */

export const vReserveResult = v.object({
  bucketId: v.id("usageBuckets"),
  reservationId: v.id("usageReservations"),
  /** `true` when the (workspaceId, operationKey) pair already had a
   *  reservation — the recorded row is returned unchanged. */
  replayed: v.boolean(),
});

/**
 * Reserve `quantity` from the bucket, creating the bucket on first use.
 * The capacity check (`reserved + committed + uncertain + quantity <=
 * limit`) runs inside this transaction, so concurrent sends serialize on
 * the bucket row and cannot oversubscribe. `limit` is refreshed on every
 * call so a lowered policy applies immediately.
 *
 * Idempotent per (workspaceId, operationKey, bucket): a replayed reserve
 * returns the live reservation instead of double-debiting.
 */
export const reserve = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    scopeKey: v.string(),
    metric: vUsageMetric,
    periodKey: v.string(),
    limit: v.number(),
    operationKey: v.string(),
    quantity: v.optional(v.number()),
  },
  returns: vReserveResult,
  handler: async (ctx, args) => {
    const quantity = args.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw invalid("quantity must be a positive integer");
    }
    const scopeKey = boundedString(args.scopeKey, "scopeKey", {
      min: 1,
      max: 100,
    });
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
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) =>
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
      // Keep the cap current — a lowered policy applies immediately.
      if (bucket.limit !== args.limit) {
        await ctx.db.patch("usageBuckets", bucketId, {
          limit: args.limit,
          updatedAt: now,
        });
      }
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

    const effective = await ctx.db.get("usageBuckets", bucketId);
    if (effective === null) {
      throw domainError("NOT_FOUND", "usage bucket not found");
    }
    if (
      effective.reserved + effective.committed + effective.uncertain + quantity >
      effective.limit
    ) {
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
  },
});

const vSettleResult = v.object({
  reservation: vUsageReservationDoc,
  /** `true` when the reservation was already in the requested terminal
   *  state — an idempotent replay. */
  replayed: v.boolean(),
});

/**
 * Shared settle path: a `reserved` (or `uncertain` → `committed`) row moves
 * to the target state and the bucket counters shift by `quantity`. Other
 * transitions are `CONFLICT` — a released reservation can never be
 * re-committed, an uncertain one can only commit or stay uncertain.
 */
async function settleReservation(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    operationKey: string;
    target: UsageReservationState;
    providerReference?: string;
  },
): Promise<{ reservation: Doc<"usageReservations">; replayed: boolean }> {
  const operationKey = boundedString(args.operationKey, "operationKey", {
    min: 1,
    max: 200,
  });
  const reservations = await ctx.db
    .query("usageReservations")
    .withIndex("by_workspaceId_and_operationKey_and_bucketId", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("operationKey", operationKey),
    )
    .collect();
  if (reservations.length === 0) {
    throw domainError(
      "NOT_FOUND",
      `no reservation for operation ${operationKey}`,
    );
  }
  if (reservations.length > 1) {
    throw domainError(
      "CONFLICT",
      `operation ${operationKey} has ${reservations.length} reservations`,
    );
  }
  const reservation = reservations[0];
  if (reservation.state === args.target) {
    return { reservation, replayed: true };
  }
  const allowed: Record<UsageReservationState, UsageReservationState[]> = {
    reserved: ["committed", "released", "uncertain"],
    committed: [],
    released: [],
    uncertain: ["committed", "released"],
  };
  if (!allowed[reservation.state].includes(args.target)) {
    throw domainError(
      "CONFLICT",
      `reservation is ${reservation.state}, cannot become ${args.target}`,
    );
  }
  const bucket = await ctx.db.get("usageBuckets", reservation.bucketId);
  if (bucket === null) {
    throw domainError("NOT_FOUND", "usage bucket not found");
  }
  const qty = reservation.quantity;
  const counters: Record<UsageReservationState, Partial<Doc<"usageBuckets">>> = {
    committed:
      reservation.state === "uncertain"
        ? { uncertain: bucket.uncertain - qty, committed: bucket.committed + qty }
        : { reserved: bucket.reserved - qty, committed: bucket.committed + qty },
    released:
      reservation.state === "uncertain"
        ? { uncertain: bucket.uncertain - qty }
        : { reserved: bucket.reserved - qty },
    uncertain: { reserved: bucket.reserved - qty, uncertain: bucket.uncertain + qty },
    reserved: {},
  };
  const now = Date.now();
  await ctx.db.patch("usageBuckets", bucket._id, {
    ...counters[args.target],
    updatedAt: now,
  });
  await ctx.db.patch("usageReservations", reservation._id, {
    state: args.target,
    updatedAt: now,
    ...(args.providerReference !== undefined
      ? { providerReference: args.providerReference }
      : {}),
  });
  const updated = await ctx.db.get("usageReservations", reservation._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "reservation not found after update");
  }
  return { reservation: updated, replayed: false };
}

/** Commit — the debited capacity became a real provider-accepted send. */
export const commit = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationKey: v.string(),
    providerReference: v.optional(v.string()),
  },
  returns: vSettleResult,
  handler: async (ctx, args) =>
    await settleReservation(ctx, {
      workspaceId: args.workspaceId,
      operationKey: args.operationKey,
      target: "committed",
      providerReference:
        args.providerReference === undefined
          ? undefined
          : boundedString(args.providerReference, "providerReference", {
              min: 1,
              max: 300,
            }),
    }),
});

/** Release — the attempt definitively failed or was cancelled before any
 *  provider effect; capacity is returned. */
export const release = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationKey: v.string(),
  },
  returns: vSettleResult,
  handler: async (ctx, args) =>
    await settleReservation(ctx, {
      workspaceId: args.workspaceId,
      operationKey: args.operationKey,
      target: "released",
    }),
});

/** Uncertain — the outcome is unknown; capacity STAYS blocked (not freed)
 *  until reconciliation commits or human review releases it. */
export const markUncertain = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationKey: v.string(),
  },
  returns: vSettleResult,
  handler: async (ctx, args) =>
    await settleReservation(ctx, {
      workspaceId: args.workspaceId,
      operationKey: args.operationKey,
      target: "uncertain",
    }),
});

/** Internal lookup for a reservation by its stable operation key. */
export const getByOperationKey = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    operationKey: v.string(),
  },
  returns: v.union(vUsageReservationDoc, v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("usageReservations")
      .withIndex("by_workspaceId_and_operationKey_and_bucketId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("operationKey", args.operationKey),
      )
      .take(2);
    return rows[0] ?? null;
  },
});
