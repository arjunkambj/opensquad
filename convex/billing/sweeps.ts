/**
 * The belt behind every paid call (PLAN §6 "recovery sweep").
 *
 * Two jobs, and the asymmetry between them is the whole money rule:
 *
 *   A lost action → `uncertain`. An operation whose row has not moved since
 *   before any action could still be alive lost its settle. We cannot prove
 *   the request never left, so the hold STAYS and blocks capacity.
 *
 *   An old `uncertain` → committed at worst case. After 24 hours with no
 *   reconciliation, we bill ourselves. Releasing would hand back money we may
 *   have spent; only `billing/settlement.ts#reconcilePaidCall` — a provider
 *   task that actually looked the operation up — may release one.
 *
 * Both passes are bounded and idempotent, so a cron that runs twice, or lands
 * on the same page twice, changes nothing the second time.
 */
import { internalMutation } from "../_generated/server";
import {
  paidCallStaleMs,
  SWEEP_BATCH_SIZE,
  uncertainHoldMaxAgeMs,
} from "../lib/limits";
import { settlePaidCallImpl } from "./settlement";
import { v } from "convex/values";

const vSweepReport = v.object({
  scanned: v.number(),
  settled: v.number(),
});

/**
 * Park paid calls whose action died before it could settle. `requested` and
 * `accepted` both mean "the provider may already have billed us", so the
 * honest move is an explicit unknown, never a release.
 */
export const parkStalePaidCalls = internalMutation({
  args: {},
  returns: vSweepReport,
  handler: async (ctx) => {
    const cutoff = Date.now() - paidCallStaleMs();
    let scanned = 0;
    let settled = 0;
    for (const state of ["requested", "accepted"] as const) {
      const stale = await ctx.db
        .query("providerOperations")
        .withIndex("by_state_and_updatedAt", (q) =>
          q.eq("state", state).lt("updatedAt", cutoff),
        )
        .take(SWEEP_BATCH_SIZE);
      scanned += stale.length;
      for (const operation of stale) {
        await settlePaidCallImpl(ctx, {
          operationId: operation._id,
          outcome: "uncertain",
        });
        settled += 1;
      }
    }
    return { scanned, settled };
  },
});

/**
 * Resolve holds nothing reconciled in time: committed at worst case, exactly
 * as PLAN §6 states. The Usage tab stops showing them as pending and the
 * capacity they blocked is now honestly spent.
 */
export const commitExpiredHolds = internalMutation({
  args: {},
  returns: vSweepReport,
  handler: async (ctx) => {
    const cutoff = Date.now() - uncertainHoldMaxAgeMs();
    const expired = await ctx.db
      .query("providerOperations")
      .withIndex("by_state_and_updatedAt", (q) =>
        q.eq("state", "uncertain").lt("updatedAt", cutoff),
      )
      .take(SWEEP_BATCH_SIZE);
    let settled = 0;
    for (const operation of expired) {
      await settlePaidCallImpl(ctx, {
        operationId: operation._id,
        outcome: "billed",
      });
      settled += 1;
    }
    return { scanned: expired.length, settled };
  },
});
