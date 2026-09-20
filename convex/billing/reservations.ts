/**
 * The usage ledger's internal mutation surface — reserve → commit | release |
 * uncertain, for callers that settle from an ACTION and therefore need a
 * function reference rather than a model call.
 *
 * Every handler here is thin: it validates, then calls the ledger model
 * (`billing/model.ts`, `billing/transitions.ts`), where the rules live. Anything already running inside a
 * mutation (the credit wrapper, the send boundary's own reserve) calls the
 * model directly — a `ctx.runMutation` hop would split one transaction in two.
 *
 * Sends are bucketed by the org-local day (`localDayKey(now,
 * org.timezone)`), enforced inside the reserving transaction so
 * concurrent sends cannot oversubscribe the daily limit.
 */
import { internalMutation } from "../_generated/server";
import { boundedString, vUsageMetric } from "../lib/validators";
import { reserveInBucket } from "./model";
import { vUsageReservationDoc } from "./queries";
import { settleReservationsByKey } from "./transitions";
import { v } from "convex/values";

export const vReserveResult = v.object({
  bucketId: v.id("usageBuckets"),
  reservationId: v.id("usageReservations"),
  /** `true` when the (orgId, operationKey) pair already had a
   *  reservation — the recorded row is returned unchanged. */
  replayed: v.boolean(),
});

/**
 * Reserve `quantity` from the bucket, creating the bucket on first use. The
 * capacity check runs inside this transaction, so concurrent callers
 * serialize on the bucket row and cannot oversubscribe.
 *
 * Idempotent per (orgId, operationKey, bucket): a replayed reserve
 * returns the live reservation instead of double-debiting.
 */
export const reserve = internalMutation({
  args: {
    orgId: v.id("orgs"),
    scopeKey: v.string(),
    metric: vUsageMetric,
    periodKey: v.string(),
    limit: v.number(),
    operationKey: v.string(),
    quantity: v.optional(v.number()),
  },
  returns: vReserveResult,
  handler: async (ctx, args) => await reserveInBucket(ctx, args),
});

const vSettleResult = v.object({
  reservation: vUsageReservationDoc,
  /** `true` when the reservation was already in the requested terminal
   *  state — an idempotent replay. */
  replayed: v.boolean(),
});

/** Commit — the debited capacity became real, provider-accepted work. */
export const commit = internalMutation({
  args: {
    orgId: v.id("orgs"),
    operationKey: v.string(),
    providerReference: v.optional(v.string()),
  },
  returns: vSettleResult,
  handler: async (ctx, args) =>
    await settleReservationsByKey(ctx, {
      orgId: args.orgId,
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
    orgId: v.id("orgs"),
    operationKey: v.string(),
  },
  returns: vSettleResult,
  handler: async (ctx, args) =>
    await settleReservationsByKey(ctx, {
      orgId: args.orgId,
      operationKey: args.operationKey,
      target: "released",
    }),
});

/** Uncertain — the outcome is unknown; capacity STAYS blocked (not freed)
 *  until reconciliation commits or human review releases it. */
export const markUncertain = internalMutation({
  args: {
    orgId: v.id("orgs"),
    operationKey: v.string(),
  },
  returns: vSettleResult,
  handler: async (ctx, args) =>
    await settleReservationsByKey(ctx, {
      orgId: args.orgId,
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
    orgId: v.id("orgs"),
    operationKey: v.string(),
  },
  returns: v.union(vUsageReservationDoc, v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("usageReservations")
      .withIndex("by_orgId_and_operationKey_and_bucketId", (q) =>
        q
          .eq("orgId", args.orgId)
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
