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
 */
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireWorkspaceEditor } from "./lib/auth";
import {
  boundedLimit,
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
    const limit = boundedLimit(args.limit);
    const buckets = await ctx.db
      .query("usageBuckets")
      .withIndex(
        "by_workspaceId_and_scopeKey_and_metric_and_periodKey",
        (q) => q.eq("workspaceId", args.workspaceId),
      )
      .collect();
    return buckets
      .filter((bucket) => args.metric === undefined || bucket.metric === args.metric)
      .slice(0, limit)
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
 * Shared settle path: every reservation under the operation key moves to the
 * target state and each owning bucket's counters shift by that row's
 * `quantity`. An operation may hold per-bucket reservations (the reserve
 * dedupe key is `(operationKey, bucketId)`), so all of them settle together
 * — one logical outcome, every debit accounted. Rows already in `target`
 * replay; any other illegal transition is a `CONFLICT` and rolls the whole
 * batch back — a released reservation can never be re-committed, an
 * uncertain one can only commit or release.
 *
 * Rows left behind by an earlier bucket are the exception: see the skip below.
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
  const allowed: Record<UsageReservationState, UsageReservationState[]> = {
    reserved: ["committed", "released", "uncertain"],
    committed: [],
    released: [],
    uncertain: ["committed", "released"],
  };
  const now = Date.now();
  // An attempt parked past its local day releases the stale-bucket row and
  // re-reserves under today's bucket (`beginDispatch`), so one operationKey can
  // own several rows. The newest is this operation's live reservation; every
  // older row already moved its own bucket's counters and is settled history,
  // so it is skipped instead of conflicting the whole settle. The newest row is
  // never skipped — a live reservation that cannot reach the target is a
  // genuine illegal transition and still throws.
  const current = reservations.reduce((newest, row) =>
    row._creationTime > newest._creationTime ? row : newest,
  );
  let settled: Doc<"usageReservations"> | null = null;
  let replayed: Doc<"usageReservations"> | null = null;
  for (const reservation of reservations) {
    if (reservation.state === args.target) {
      replayed ??= reservation;
      continue;
    }
    if (
      reservation._id !== current._id &&
      (reservation.state === "committed" || reservation.state === "released")
    ) {
      continue;
    }
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
    const counters: Record<
      UsageReservationState,
      Partial<Doc<"usageBuckets">>
    > = {
      committed:
        reservation.state === "uncertain"
          ? {
              uncertain: bucket.uncertain - qty,
              committed: bucket.committed + qty,
            }
          : {
              reserved: bucket.reserved - qty,
              committed: bucket.committed + qty,
            },
      released:
        reservation.state === "uncertain"
          ? { uncertain: bucket.uncertain - qty }
          : { reserved: bucket.reserved - qty },
      uncertain: {
        reserved: bucket.reserved - qty,
        uncertain: bucket.uncertain + qty,
      },
      reserved: {},
    };
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
    settled ??= await ctx.db.get("usageReservations", reservation._id);
  }
  // Prefer the row this call moved: a stale sibling must never stand in for
  // the live reservation the caller settled.
  const first = settled ?? replayed;
  if (first === null) {
    throw domainError("NOT_FOUND", "reservation not found after update");
  }
  return { reservation: first, replayed: settled === null };
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
              // ≥ the 400-char bound on `messageId` in recordSendOutcome —
              // a longer provider ref must never wedge the settle path.
              max: 400,
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

/**
 * Internal lookup for a reservation by its stable operation key. One
 * operation may hold a row per bucket — callers asking "is a reservation
 * still live" must see a `reserved`/`uncertain` row, not whichever settled
 * row sorts first.
 */
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
      .collect();
    return (
      rows.find((row) => row.state === "reserved" || row.state === "uncertain") ??
      rows[0] ??
      null
    );
  },
});
