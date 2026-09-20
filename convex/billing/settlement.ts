/**
 * How a paid call ends: the accounting half of `withCredits`, plus the
 * reconciliation door a provider task knocks on when it finally learns what
 * an `uncertain` hold really cost.
 *
 * The rules, in the order they matter:
 *   - Credits commit at the POSTED price when the provider did the work. The
 *     user is charged what the button said, not what the provider invoiced.
 *   - Provider units commit at the provider's REPORTED ACTUAL, and the rest
 *     of the worst-case reservation — workspace buckets and platform budget
 *     alike — is released.
 *   - `commit` and `release` are terminal. `markUncertain` is not: it is the
 *     one settlement reconciliation may still move, which is exactly what
 *     "never released without proof" means.
 */
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { ProviderUnits, TrialMeteredMetric } from "../lib/limits";
import {
  computeResultDigest,
  domainError,
  vProviderKind,
} from "../lib/validators";
import { applyReservationTransition, reduceReservation } from "./transitions";
import {
  actionOfOperationKey,
  paidCallReceipt,
  vPaidOutcome,
  vProviderUnits,
  vRefundReason,
} from "./paidCall";
import type { PaidOutcome, RefundReason } from "./paidCall";
import { creditPlatformBudget } from "./platformBudgets";
import { v } from "convex/values";

export type SettleResult = {
  outcome: PaidOutcome;
  credits: number;
  providerUnits: ProviderUnits;
  replayed: boolean;
};

export type SettleArgs = {
  operationId: Id<"providerOperations">;
  outcome: PaidOutcome;
  actualUnits?: ProviderUnits;
  reason?: RefundReason;
  resultRef?: string;
  providerReference?: string;
};

type LedgerRow = {
  reservation: Doc<"usageReservations">;
  metric: Doc<"usageBuckets">["metric"];
};

/** The reservations this operation took — read from the operation itself, so
 *  a settle can never move a debit the operation does not own. */
async function ledgerRows(
  ctx: MutationCtx,
  operation: Doc<"providerOperations">,
): Promise<LedgerRow[]> {
  const rows: LedgerRow[] = [];
  for (const reservationId of operation.reservationIds) {
    const reservation = await ctx.db.get("usageReservations", reservationId);
    if (reservation === null) {
      continue;
    }
    const bucket = await ctx.db.get("usageBuckets", reservation.bucketId);
    if (bucket === null) {
      continue;
    }
    rows.push({ reservation, metric: bucket.metric });
  }
  return rows;
}

function maxInto(units: ProviderUnits, metric: TrialMeteredMetric, value: number): void {
  units[metric] = Math.max(units[metric] ?? 0, value);
}

/** The outcome a settlement already recorded. */
function outcomeOfSettlement(
  operation: Doc<"providerOperations">,
): PaidOutcome {
  if (operation.settlement === "commit") {
    return "billed";
  }
  if (operation.settlement === "release") {
    return "refunded";
  }
  return "uncertain";
}

export async function settlePaidCallImpl(
  ctx: MutationCtx,
  args: SettleArgs,
): Promise<SettleResult> {
  const operation = await ctx.db.get("providerOperations", args.operationId);
  if (operation === null) {
    throw domainError("NOT_FOUND", "provider operation not found");
  }
  const rows = await ledgerRows(ctx, operation);

  // `commit` and `release` are final; `markUncertain` may still be resolved.
  if (operation.settlement === "commit" || operation.settlement === "release") {
    const held: ProviderUnits = {};
    let credits = 0;
    for (const row of rows) {
      if (row.reservation.state !== "committed") {
        continue;
      }
      if (row.metric === "credits") {
        credits = Math.max(credits, row.reservation.quantity);
        continue;
      }
      maxInto(held, row.metric as TrialMeteredMetric, row.reservation.quantity);
    }
    return {
      outcome: outcomeOfSettlement(operation),
      credits,
      providerUnits: held,
      replayed: true,
    };
  }

  const now = Date.now();
  const worstCase: ProviderUnits = {};
  const charged: ProviderUnits = {};
  let credits = 0;

  if (args.outcome === "billed") {
    for (const row of rows) {
      const { reservation, metric } = row;
      if (metric === "credits") {
        if (reservation.state === "reserved" || reservation.state === "uncertain") {
          await applyReservationTransition(
            ctx,
            reservation,
            "committed",
            args.providerReference,
          );
        }
        credits = Math.max(credits, reservation.quantity);
        continue;
      }
      const meteredMetric = metric as TrialMeteredMetric;
      maxInto(worstCase, meteredMetric, reservation.quantity);
      if (reservation.state === "reserved") {
        const requested = args.actualUnits?.[meteredMetric];
        const actual =
          requested === undefined
            ? reservation.quantity
            : Math.max(0, Math.min(reservation.quantity, Math.trunc(requested)));
        if (actual === 0) {
          // The provider did the work but charged nothing for this metric —
          // a cache hit, a zero-row answer. Release it in full.
          await applyReservationTransition(ctx, reservation, "released");
        } else {
          const reduced = await reduceReservation(ctx, reservation, actual);
          await applyReservationTransition(
            ctx,
            reduced,
            "committed",
            args.providerReference,
          );
        }
        maxInto(charged, meteredMetric, actual);
      } else if (reservation.state === "uncertain") {
        // An uncertain hold resolves at its worst case: the capacity was
        // blocked precisely because we could not prove a smaller number.
        await applyReservationTransition(
          ctx,
          reservation,
          "committed",
          args.providerReference,
        );
        maxInto(charged, meteredMetric, reservation.quantity);
      } else if (reservation.state === "committed") {
        maxInto(charged, meteredMetric, reservation.quantity);
      }
    }
  } else if (args.outcome === "refunded") {
    for (const row of rows) {
      const { reservation, metric } = row;
      if (metric !== "credits") {
        maxInto(worstCase, metric as TrialMeteredMetric, reservation.quantity);
      }
      if (reservation.state === "reserved" || reservation.state === "uncertain") {
        await applyReservationTransition(ctx, reservation, "released");
      }
    }
  } else {
    for (const row of rows) {
      const { reservation, metric } = row;
      if (reservation.state === "reserved") {
        await applyReservationTransition(ctx, reservation, "uncertain");
      }
      if (metric === "credits") {
        credits = Math.max(credits, reservation.quantity);
        continue;
      }
      maxInto(charged, metric as TrialMeteredMetric, reservation.quantity);
    }
  }

  // Give the platform its unspent budget back, against the period the debit
  // was taken in — an operation settled after midnight must not credit a
  // period it never touched. An `uncertain` outcome gives nothing back: we
  // cannot prove the units were not consumed.
  if (args.outcome !== "uncertain") {
    for (const [key, reserved] of Object.entries(worstCase)) {
      const metric = key as TrialMeteredMetric;
      await creditPlatformBudget(
        ctx,
        metric,
        reserved - (charged[metric] ?? 0),
        operation.createdAt,
      );
    }
  }

  const action = actionOfOperationKey(operation.operationKey);
  const receipt =
    action === null
      ? args.providerReference
      : paidCallReceipt({
          provider: operation.provider,
          action,
          credits,
          units: charged,
          ...(args.providerReference !== undefined
            ? { providerReference: args.providerReference }
            : {}),
        });
  const resultDigest =
    args.resultRef === undefined
      ? undefined
      : await computeResultDigest(args.resultRef);

  await ctx.db.patch("providerOperations", operation._id, {
    state:
      args.outcome === "billed"
        ? "completed"
        : args.outcome === "uncertain"
          ? "uncertain"
          : // A provider that answered and charged nothing DID complete; only
            // a refusal before any provider effect is a failure.
            args.reason === "provider_charged_nothing"
            ? "completed"
            : "failed",
    settlement:
      args.outcome === "billed"
        ? "commit"
        : args.outcome === "refunded"
          ? "release"
          : "markUncertain",
    updatedAt: now,
    ...(args.resultRef !== undefined
      ? {
          resultRef: { kind: "inline" as const, value: args.resultRef },
          resultDigest,
        }
      : {}),
    ...(receipt !== undefined ? { componentRequestRef: receipt } : {}),
    ...(args.outcome === "refunded"
      ? {
          error: {
            code: args.reason ?? "unknown",
            message: `paid call refunded: ${args.reason ?? "unknown"}`,
          },
        }
      : {}),
  });

  return {
    outcome: args.outcome,
    credits: args.outcome === "refunded" ? 0 : credits,
    providerUnits: args.outcome === "refunded" ? {} : charged,
    replayed: false,
  };
}

/**
 * Resolve a hold from OUTSIDE the original action — the door PLAN §6's
 * recovery sweep describes: a provider task that looked the operation up
 * (reveal job by id, send idempotency key) and now knows what happened calls
 * this with the answer.
 *
 * This is the only path that releases an `uncertain` hold, and it is why the
 * sweep never does: releasing without proof is handing back money we may
 * have spent.
 */
export const reconcilePaidCall = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    provider: vProviderKind,
    operationKey: v.string(),
    outcome: vPaidOutcome,
    actualUnits: v.optional(vProviderUnits),
    reason: v.optional(vRefundReason),
    providerReference: v.optional(v.string()),
  },
  returns: v.object({
    outcome: vPaidOutcome,
    credits: v.number(),
    providerUnits: vProviderUnits,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args): Promise<SettleResult> => {
    const operation = await ctx.db
      .query("providerOperations")
      .withIndex("by_workspaceId_and_provider_and_operationKey", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("provider", args.provider)
          .eq("operationKey", args.operationKey),
      )
      .unique();
    if (operation === null) {
      throw domainError("NOT_FOUND", "provider operation not found");
    }
    return await settlePaidCallImpl(ctx, {
      operationId: operation._id,
      outcome: args.outcome,
      ...(args.actualUnits !== undefined ? { actualUnits: args.actualUnits } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      ...(args.providerReference !== undefined
        ? { providerReference: args.providerReference }
        : {}),
    });
  },
});
