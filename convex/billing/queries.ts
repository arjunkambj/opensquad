/** Expose user actions and credits only; provider names, units and hidden caps stay server-side. */
import { query } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { boundedLimit } from "../lib/validators";
import { usageReservationFields } from "../schema";
import { findCreditsBucket } from "./model";
import { actionOfOperationKey, vPaidAction } from "./paidCall";
import { trialCapacityOpen } from "./platformBudgets";
import { v } from "convex/values";

export const vUsageReservationDoc = v.object({
  _id: v.id("usageReservations"),
  _creationTime: v.number(),
  ...usageReservationFields,
});

/** One line of the Usage tab. */
export const vUsageEntry = v.object({
  id: v.id("usageReservations"),
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
 * The org's credit history, newest first.
 *
 * Opaque cursors preserve entries that share a timestamp at page boundaries.
 */
export const history = query({
  args: {
    orgId: v.id("orgs"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    entries: v.array(vUsageEntry),
    nextCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    const limit = Math.min(boundedLimit(args.limit), USAGE_PAGE_MAX);
    const bucket = await findCreditsBucket(ctx, args.orgId);
    if (bucket === null) {
      return { entries: [], nextCursor: null };
    }
    const rows = await ctx.db
      .query("usageReservations")
      .withIndex("by_bucketId_and_createdAt", (q) => q.eq("bucketId", bucket._id))
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    const entries = rows.page.map((row) => ({
      id: row._id,
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
    return {
      entries,
      nextCursor: rows.isDone ? null : rows.continueCursor,
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
