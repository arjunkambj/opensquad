/**
 * How a debit is SETTLED: the state machine of a `usageReservations` row.
 *
 * `reserved` at intent, then exactly one of `committed`, `released` or
 * `uncertain` — and `uncertain` is not a resting state but a blocked one,
 * deliberately: an ambiguous failure keeps consuming the allowance until
 * something reconciles it, which is the only honest accounting when we
 * cannot tell whether we were charged.
 *
 * A released reservation can never be re-committed, and an uncertain one can
 * only commit or release. Every transition moves its own bucket's counters by
 * that row's `quantity`, inside the caller's transaction.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { boundedString, domainError, invalid } from "../lib/validators";
import type { UsageReservationState } from "../lib/validators";

const ALLOWED_TRANSITIONS: Record<
  UsageReservationState,
  readonly UsageReservationState[]
> = {
  reserved: ["committed", "released", "uncertain"],
  committed: [],
  released: [],
  uncertain: ["committed", "released"],
};

/**
 * Move ONE reservation to a terminal state and shift its bucket's counters by
 * that row's `quantity`. A row already in `target` is an idempotent replay and
 * returns `false`; an illegal transition throws, so a released reservation can
 * never be re-committed.
 */
export async function applyReservationTransition(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  target: UsageReservationState,
  providerReference?: string,
): Promise<boolean> {
  if (reservation.state === target) {
    return false;
  }
  if (!ALLOWED_TRANSITIONS[reservation.state].includes(target)) {
    throw domainError(
      "CONFLICT",
      `reservation is ${reservation.state}, cannot become ${target}`,
    );
  }
  const bucket = await ctx.db.get("usageBuckets", reservation.bucketId);
  if (bucket === null) {
    throw domainError("NOT_FOUND", "usage bucket not found");
  }
  const qty = reservation.quantity;
  const fromUncertain = reservation.state === "uncertain";
  const counters: Record<
    UsageReservationState,
    Partial<Doc<"usageBuckets">>
  > = {
    committed: fromUncertain
      ? { uncertain: bucket.uncertain - qty, committed: bucket.committed + qty }
      : { reserved: bucket.reserved - qty, committed: bucket.committed + qty },
    released: fromUncertain
      ? { uncertain: bucket.uncertain - qty }
      : { reserved: bucket.reserved - qty },
    uncertain: {
      reserved: bucket.reserved - qty,
      uncertain: bucket.uncertain + qty,
    },
    reserved: {},
  };
  const now = Date.now();
  await ctx.db.patch("usageBuckets", bucket._id, {
    ...counters[target],
    updatedAt: now,
  });
  await ctx.db.patch("usageReservations", reservation._id, {
    state: target,
    updatedAt: now,
    ...(providerReference !== undefined ? { providerReference } : {}),
  });
  return true;
}

/**
 * Shrink an unsettled debit before settling it — the "commit the provider's
 * actual, release the rest" half of PLAN §6. The freed capacity returns to
 * the bucket immediately, so a worst-case reservation never blocks more than
 * the provider really charged.
 *
 * An `uncertain` hold may be reduced too, and by the same rule: reconciliation
 * is the one door that learns what an ambiguous call really cost, and holding
 * a provably smaller charge at its worst case blocks capacity we know was
 * never spent. Only the counter differs — an uncertain hold sits in the
 * bucket's `uncertain`, not its `reserved`. A `committed` or `released` row
 * is terminal and still refuses.
 */
export async function reduceReservation(
  ctx: MutationCtx,
  reservation: Doc<"usageReservations">,
  quantity: number,
): Promise<Doc<"usageReservations">> {
  if (reservation.state !== "reserved" && reservation.state !== "uncertain") {
    throw domainError(
      "CONFLICT",
      `reservation is ${reservation.state} and can no longer be reduced`,
    );
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw invalid("quantity must be a non-negative integer");
  }
  if (quantity > reservation.quantity) {
    throw invalid("a reservation can only be reduced, never raised");
  }
  if (quantity === reservation.quantity) {
    return reservation;
  }
  const bucket = await ctx.db.get("usageBuckets", reservation.bucketId);
  if (bucket === null) {
    throw domainError("NOT_FOUND", "usage bucket not found");
  }
  const now = Date.now();
  const freed = reservation.quantity - quantity;
  await ctx.db.patch("usageBuckets", bucket._id, {
    ...(reservation.state === "uncertain"
      ? { uncertain: bucket.uncertain - freed }
      : { reserved: bucket.reserved - freed }),
    updatedAt: now,
  });
  await ctx.db.patch("usageReservations", reservation._id, {
    quantity,
    updatedAt: now,
  });
  const updated = await ctx.db.get("usageReservations", reservation._id);
  if (updated === null) {
    throw domainError("NOT_FOUND", "reservation not found after reduce");
  }
  return updated;
}

/** Every reservation an operation holds — one per bucket it debited. */
export async function listReservationsByKey(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
  operationKey: string,
): Promise<Doc<"usageReservations">[]> {
  return await ctx.db
    .query("usageReservations")
    .withIndex("by_orgId_and_operationKey_and_bucketId", (q) =>
      q.eq("orgId", orgId).eq("operationKey", operationKey),
    )
    .collect();
}

/**
 * Settle every reservation under one operation key together — one logical
 * outcome, every debit accounted.
 *
 * Rows left behind by an earlier bucket are the exception. An attempt parked
 * past its local day releases the stale-bucket row and re-reserves under
 * today's bucket (`beginDispatch`), so one operationKey can own several rows.
 * The newest is this operation's live reservation; every older row already
 * moved its own bucket's counters and is settled history, so it is skipped
 * instead of conflicting the whole settle. The newest row is never skipped —
 * a live reservation that cannot reach the target is a genuine illegal
 * transition and still throws.
 */
export async function settleReservationsByKey(
  ctx: MutationCtx,
  args: {
    orgId: Id<"orgs">;
    operationKey: string;
    target: UsageReservationState;
    providerReference?: string;
  },
): Promise<{ reservation: Doc<"usageReservations">; replayed: boolean }> {
  const operationKey = boundedString(args.operationKey, "operationKey", {
    min: 1,
    max: 200,
  });
  const reservations = await listReservationsByKey(
    ctx,
    args.orgId,
    operationKey,
  );
  if (reservations.length === 0) {
    throw domainError("NOT_FOUND", `no reservation for operation ${operationKey}`);
  }
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
    await applyReservationTransition(
      ctx,
      reservation,
      args.target,
      args.providerReference,
    );
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
