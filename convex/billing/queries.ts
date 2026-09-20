/**
 * What a member may read about their own spending: the Settings → Usage tab
 * and the waitlist state, and nothing else.
 *
 * WHITE-LABEL (PLAN §4). Every line is an ACTION the user took — "get_email",
 * "find_leads" — with its credit price, its outcome and when it happened. The
 * provider-unit buckets, their metric names and the provider behind them are
 * server-side facts and never appear in a payload here. That is also why the
 * old raw-bucket `summary` is gone: it returned `enrich_credits` to a client.
 */
import { query } from "../_generated/server";
import { requireWorkspaceMember } from "../lib/auth";
import { boundedInt, boundedLimit } from "../lib/validators";
import { usageBucketFields, usageReservationFields } from "../schema";
import { findCreditsBucket } from "./model";
import { actionOfOperationKey, vPaidAction } from "./paidCall";
import { trialCapacityOpen } from "./platformBudgets";
import { v } from "convex/values";

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

/** One line of the Usage tab. */
export const vUsageEntry = v.object({
  /** The action the member took. A label KEY: the client owns the wording. */
  action: v.union(vPaidAction, v.literal("other")),
  /** Credits this line moved. Zero for a first-run-free step. */
  credits: v.number(),
  /**
   * `billed` — spent. `refunded` — given back. `pending` — held while the
   * outcome is unknown, which is what PLAN §6's `uncertain` looks like to a
   * member.
   */
  outcome: v.union(
    v.literal("billed"),
    v.literal("refunded"),
    v.literal("pending"),
  ),
  at: v.number(),
});

const USAGE_PAGE_MAX = 50;

/**
 * The workspace's credit history, newest first.
 *
 * Paginated by a keyset on the entry's own timestamp: pass the last `at` of a
 * page back as `before` to get the next one. It reads only the reservations
 * of the lifetime `credits` bucket, which the trial grant itself bounds — the
 * entire history of a 300-credit workspace is a few hundred rows.
 */
export const history = query({
  args: {
    workspaceId: v.id("workspaces"),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  returns: v.object({
    entries: v.array(vUsageEntry),
    /** Pass back as `before` for the next page; `null` at the end. */
    nextBefore: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    const limit = Math.min(boundedLimit(args.limit), USAGE_PAGE_MAX);
    const before =
      args.before === undefined
        ? undefined
        : boundedInt(args.before, "before", {
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
          });

    const bucket = await findCreditsBucket(ctx, args.workspaceId);
    if (bucket === null) {
      return { entries: [], nextBefore: null };
    }
    const rows = await ctx.db
      .query("usageReservations")
      .withIndex("by_bucketId_and_state", (q) => q.eq("bucketId", bucket._id))
      .collect();

    const ordered = rows
      .filter((row) => before === undefined || row.createdAt < before)
      .sort((left, right) => right.createdAt - left.createdAt);
    const page = ordered.slice(0, limit);
    const entries = page.map((row) => ({
      action: actionOfOperationKey(row.operationKey) ?? ("other" as const),
      credits: row.quantity,
      outcome:
        row.state === "committed"
          ? ("billed" as const)
          : row.state === "released"
            ? ("refunded" as const)
            : ("pending" as const),
      at: row.createdAt,
    }));
    const last = page.at(-1);
    return {
      entries,
      nextBefore:
        ordered.length > page.length && last !== undefined
          ? last.createdAt
          : null,
    };
  },
});

/**
 * Is the trial still open to new signups? Unauthenticated-safe on purpose —
 * the sign-up screen asks before anyone has an account — and deliberately a
 * boolean: how many tenants exist is not something a visitor learns here.
 */
export const trialOpen = query({
  args: {},
  returns: v.object({ open: v.boolean() }),
  handler: async (ctx) => ({ open: await trialCapacityOpen(ctx) }),
});
