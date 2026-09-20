/**
 * `withCredits` — the one door every paid provider call goes through
 * (PLAN §6, AGENTS.md "Money safety").
 *
 * Reserve in one transaction (`billing/reserve.ts`) → run the work → settle
 * in one transaction (`billing/settlement.ts`). A crash between the halves
 * leaves a hold that blocks capacity rather than a silent overdraft.
 *
 * Three outcomes, never two:
 *   billed      the provider did the work. Credits commit at the posted
 *               price, provider units commit at the provider's reported
 *               actual and the rest of the reservation is released.
 *   refunded    refused before any provider effect, or the provider answered
 *               and charged nothing. Everything is released.
 *   uncertain   the request left us and we do not know. The hold STAYS,
 *               because handing back money we may have spent is not a refund.
 *
 * Idempotent by `operationKey`: a retry of a settled operation returns the
 * recorded outcome and its result reference without reserving or calling
 * again, so a billed upstream step is never re-bought.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { PaidAction, ProviderUnits } from "../lib/limits";
import type { PaidCallOutcome, PaidWork } from "./paidCall";
import { vPaidOutcome, vProviderUnits, vRefundReason } from "./paidCall";
import type { BeginResult } from "./reserve";
import { settlePaidCallImpl } from "./settlement";
import type { SettleResult } from "./settlement";
import { v } from "convex/values";

/**
 * Settle one paid call: commit what was spent, release what was not, or park
 * the hold as `uncertain`. Idempotent — a second settle returns the recorded
 * outcome without moving a counter.
 */
export const settlePaidCall = internalMutation({
  args: {
    operationId: v.id("providerOperations"),
    outcome: vPaidOutcome,
    actualUnits: v.optional(vProviderUnits),
    reason: v.optional(vRefundReason),
    resultRef: v.optional(v.string()),
    providerReference: v.optional(v.string()),
  },
  returns: v.object({
    outcome: vPaidOutcome,
    credits: v.number(),
    providerUnits: vProviderUnits,
    replayed: v.boolean(),
  }),
  handler: async (ctx, args): Promise<SettleResult> =>
    await settlePaidCallImpl(ctx, args),
});

/**
 * Run `fn` as a paid call.
 *
 * `fn` runs OUTSIDE the reserving transaction (it talks to a provider), and
 * what it returns is taken as the truth about what was charged. A thrown
 * error means the request may have left us, so the hold is parked as
 * `uncertain` and the error is rethrown for the caller's own retry ladder —
 * classify provable pre-flight refusals inside `fn` and RETURN
 * `{ outcome: "refunded", reason }` instead.
 */
export async function withCredits<R>(
  ctx: ActionCtx,
  args: {
    orgId: Id<"orgs">;
    action: PaidAction;
    operationKey: string;
    worstCaseProviderUnits?: ProviderUnits;
  },
  fn: () => Promise<PaidWork<R>>,
): Promise<PaidCallOutcome<R>> {
  const begin: BeginResult = await ctx.runMutation(
    internal.billing.reserve.beginPaidCall,
    {
      orgId: args.orgId,
      action: args.action,
      operationKey: args.operationKey,
      ...(args.worstCaseProviderUnits !== undefined
        ? { worstCaseProviderUnits: args.worstCaseProviderUnits }
        : {}),
    },
  );

  if (begin.decision === "refused") {
    return {
      kind: "refunded",
      replayed: false,
      reason: begin.reason,
      operationKey: begin.operationKey,
      operationId: null,
    };
  }
  if (begin.decision === "replay") {
    if (begin.outcome === "billed") {
      return {
        kind: "billed",
        replayed: true,
        resultRef: begin.resultRef ?? null,
        credits: begin.credits,
        providerUnits: begin.providerUnits,
        operationKey: begin.operationKey,
        operationId: begin.operationId,
      };
    }
    if (begin.outcome === "refunded") {
      return {
        kind: "refunded",
        replayed: true,
        reason: begin.reason ?? "unknown",
        operationKey: begin.operationKey,
        operationId: begin.operationId,
      };
    }
    return {
      kind: "uncertain",
      hold: {
        operationKey: begin.operationKey,
        operationId: begin.operationId,
        credits: begin.credits,
        providerUnits: begin.providerUnits,
      },
    };
  }

  let work: PaidWork<R>;
  try {
    work = await fn();
  } catch (error) {
    // The request may have left us. Park the hold and let the caller's own
    // error handling see the cause.
    try {
      await ctx.runMutation(internal.billing.withCredits.settlePaidCall, {
        operationId: begin.operationId,
        outcome: "uncertain",
      });
    } catch {
      // A failed settle must not replace the real error; the sweep parks the
      // operation instead.
    }
    throw error;
  }

  const settled: SettleResult = await ctx.runMutation(
    internal.billing.withCredits.settlePaidCall,
    {
      operationId: begin.operationId,
      outcome: work.outcome,
      ...(work.outcome === "billed" && work.actualUnits !== undefined
        ? { actualUnits: work.actualUnits }
        : {}),
      ...(work.outcome === "refunded" ? { reason: work.reason } : {}),
      ...(work.outcome === "billed" && work.resultRef !== undefined
        ? { resultRef: work.resultRef }
        : {}),
      ...(work.outcome !== "refunded" && work.providerReference !== undefined
        ? { providerReference: work.providerReference }
        : {}),
    },
  );

  if (work.outcome === "billed") {
    return {
      kind: "billed",
      replayed: false,
      result: work.result,
      credits: settled.credits,
      providerUnits: settled.providerUnits,
      operationKey: begin.operationKey,
      operationId: begin.operationId,
    };
  }
  if (work.outcome === "refunded") {
    return {
      kind: "refunded",
      replayed: false,
      reason: work.reason,
      operationKey: begin.operationKey,
      operationId: begin.operationId,
    };
  }
  return {
    kind: "uncertain",
    hold: {
      operationKey: begin.operationKey,
      operationId: begin.operationId,
      credits: settled.credits,
      providerUnits: settled.providerUnits,
    },
  };
}
