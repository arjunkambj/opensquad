/**
 * The overdraft guard (PLAN §6 "Platform-wide circuit breakers"): an hourly
 * read of the lead-data account's real balance that trips the platform
 * breaker when it falls below a floor, "so drift between our ledger and
 * theirs cannot become an overdraft".
 *
 * Why it is needed at all: our ledger counts what we BELIEVE each call cost.
 * The provider counts what it actually charged, and the two can drift — an
 * uncertain hold that really was billed, a price we misread, a reveal that
 * cost more than the ten credits we reserved. The wallet is the only figure
 * that cannot drift, so it gets the last word.
 *
 * How it trips: through `billing/platformBudgets.setPlatformBreaker`, which
 * is the ONE implementation of the breaker convention and works for any
 * metric — this file only decides WHICH metrics and WHEN. The convention
 * itself, and why it is a marker on a budget row rather than a flag, is
 * documented there.
 *
 * Nothing here is client-visible and nothing names a provider to a user; the
 * refusal the UI sees is `PLATFORM_CAPACITY`, as it is for any other spent
 * budget.
 */
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { fetchWalletBalance } from "../integrations/enrich/wallet";
import { operationErrorCodeOf } from "../integrations/enrich/client";
import { readIntEnv } from "../lib/limits";
import type { TrialMeteredMetric, TunableEnvName } from "../lib/limits";
import { vOperationErrorCode } from "../lib/validators";
import type { OperationErrorCode } from "../lib/validators";
import { setPlatformBreaker } from "./platformBudgets";
import { v } from "convex/values";

/** Deployment setting: the balance below which paid lead-data calls stop.
 *  Declared in `convex.config.ts` and read through the typed `env`. */
export const ENRICH_BALANCE_FLOOR_ENV: TunableEnvName = "ENRICH_BALANCE_FLOOR";

/**
 * A floor a HEALTHY account clears.
 *
 * It is sized against what one paid call can hold — a reveal holds ten units
 * — with room for a few in flight, so the breaker fires when the wallet can
 * no longer cover the work already on its way. It is deliberately NOT sized
 * against a whole day of the platform credit budget: a fresh provider account
 * is funded with a two-figure free grant, so a floor above that would find
 * every new deployment "below the floor" on its first hourly pass and keep
 * the breaker tripped for good — lead search refusing for everyone while the
 * account was working exactly as intended. A day is already bounded by the
 * platform budgets and the per-org caps; this guard exists for the drift
 * between our ledger and theirs, which is a small number by definition.
 *
 * `ENRICH_BALANCE_FLOOR` raises it on a funded account without a deploy.
 */
export const ENRICH_BALANCE_FLOOR_DEFAULT = 25;

/** The two budgets a lead-data paid call is checked against. */
const GUARDED_METRICS: readonly TrialMeteredMetric[] = [
  "enrich_credits",
  "enrich_searches",
];

export function enrichBalanceFloor(): number {
  return readIntEnv(ENRICH_BALANCE_FLOOR_ENV, ENRICH_BALANCE_FLOOR_DEFAULT);
}

/**
 * Trip or release the lead-data breaker.
 *
 * Idempotent in both directions: a second trip adds nothing and a release
 * with no marker present changes nothing, so an hourly cron that keeps
 * finding the same answer keeps writing the same state.
 */
export const setLeadDataBreaker = internalMutation({
  args: { tripped: v.boolean() },
  returns: v.object({
    tripped: v.boolean(),
    /** The metrics whose budget row actually moved. */
    changed: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ tripped: boolean; changed: string[] }> => {
    const changed: string[] = [];
    for (const metric of GUARDED_METRICS) {
      // One convention, one implementation: `setPlatformBreaker` is shared
      // with every other watchdog, so a breaker cannot be tripped two
      // different ways on two different metrics.
      if (await setPlatformBreaker(ctx, metric, args.tripped)) {
        changed.push(metric);
      }
    }
    return { tripped: args.tripped, changed };
  },
});

/**
 * The hourly watchdog: read the real balance and set the breaker to match.
 *
 * A balance we could not read never trips anything. An unreadable wallet is
 * not evidence of an empty one, and stopping the product on a transport
 * hiccup would be the wrong failure — the platform budgets and the org
 * caps still bound the spend in the meantime.
 */
export const checkPlatformBalance = internalAction({
  args: {},
  returns: v.union(
    v.object({
      status: v.literal("checked"),
      balance: v.number(),
      floor: v.number(),
      tripped: v.boolean(),
      changed: v.array(v.string()),
    }),
    v.object({ status: v.literal("failed"), code: vOperationErrorCode }),
  ),
  handler: async (
    ctx,
  ): Promise<
    | {
        status: "checked";
        balance: number;
        floor: number;
        tripped: boolean;
        changed: string[];
      }
    | { status: "failed"; code: OperationErrorCode }
  > => {
    const read = await fetchWalletBalance();
    if (read.kind !== "ok") {
      console.error("platform balance watchdog could not read the balance", {
        reason: read.reason,
      });
      return { status: "failed", code: operationErrorCodeOf(read.reason) };
    }
    const floor = enrichBalanceFloor();
    const tripped = read.data.balance < floor;
    const applied = await ctx.runMutation(
      internal.billing.platformBalance.setLeadDataBreaker,
      { tripped },
    );
    // A tripped breaker refuses with the neutral `PLATFORM_CAPACITY` code, so
    // the only place the REASON exists is here. It is therefore logged on
    // every pass that finds the balance low, not only on the pass that
    // flipped it: an operator reading the last hour of logs must be able to
    // see why lead search is refusing, not have to guess that it was tripped
    // at some earlier hour. The release is recorded for the same reason.
    if (tripped) {
      console.error("platform balance below the floor: paid lead calls stopped", {
        balance: read.data.balance,
        floor,
        changed: applied.changed,
        alreadyTripped: applied.changed.length === 0,
      });
    } else if (applied.changed.length > 0) {
      console.warn("platform balance back above the floor: paid lead calls resumed", {
        balance: read.data.balance,
        floor,
        changed: applied.changed,
      });
    }
    return {
      status: "checked",
      balance: read.data.balance,
      floor,
      tripped,
      changed: applied.changed,
    };
  },
});
