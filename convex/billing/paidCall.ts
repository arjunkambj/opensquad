/**
 * The vocabulary of one paid call: its action, the provider units it may
 * consume, the three outcomes it can end in, and the operation key that makes
 * a retry free.
 *
 * Kept apart from `withCredits.ts` so the wrapper reads as the money rule and
 * this reads as the contract its callers program against.
 */
import type { Id } from "../_generated/dataModel";
import { ACTION_PRICES, PAID_ACTIONS } from "../lib/limits";
import type { PaidAction, ProviderUnits, TrialMeteredMetric } from "../lib/limits";
import { boundedString, invalid } from "../lib/validators";
import type { ProviderKind } from "../lib/validators";
import { v } from "convex/values";

export const vPaidAction = v.union(
  v.literal("analyze_website"),
  v.literal("generate_icp"),
  v.literal("recommend_signals"),
  v.literal("generate_keywords"),
  v.literal("find_leads"),
  v.literal("research_lead"),
  v.literal("get_email"),
  v.literal("write_email"),
  v.literal("handle_reply"),
  v.literal("profile_company"),
  v.literal("score_lead"),
);

/**
 * Worst-case provider units, declared before the call and reserved in the
 * workspace buckets AND the platform budget. Written out member by member
 * rather than as a record, so an unpriced metric cannot be smuggled in.
 */
export const vProviderUnits = v.object({
  enrich_credits: v.optional(v.number()),
  enrich_searches: v.optional(v.number()),
  ai_calls: v.optional(v.number()),
  scrapes: v.optional(v.number()),
});

/**
 * Why a paid call gave the money back. Every member is a refusal the UI has
 * its own copy for, and none of them names a provider (PLAN §4).
 *
 * `provider_charged_nothing` is the one that happens AFTER a successful
 * request: the email was not found, the search returned zero rows, the
 * provider reported zero units. PLAN §6 refunds it in full.
 */
export const REFUND_REASONS = [
  "validation",
  "kill_switch",
  "platform_capacity",
  "no_credit_grant",
  "insufficient_credits",
  "trial_limit_reached",
  "rate_limited",
  "unauthorized",
  "throttled",
  "provider_charged_nothing",
  "unknown",
] as const;

export const vRefundReason = v.union(
  v.literal("validation"),
  v.literal("kill_switch"),
  v.literal("platform_capacity"),
  v.literal("no_credit_grant"),
  v.literal("insufficient_credits"),
  v.literal("trial_limit_reached"),
  v.literal("rate_limited"),
  v.literal("unauthorized"),
  v.literal("throttled"),
  v.literal("provider_charged_nothing"),
  v.literal("unknown"),
);

export type RefundReason = (typeof REFUND_REASONS)[number];

export function toRefundReason(value: unknown): RefundReason {
  return (REFUND_REASONS as readonly string[]).includes(value as string)
    ? (value as RefundReason)
    : "unknown";
}

export const vPaidOutcome = v.union(
  v.literal("billed"),
  v.literal("refunded"),
  v.literal("uncertain"),
);

export type PaidOutcome = "billed" | "refunded" | "uncertain";

/**
 * What the work itself reports back. THE RULE: a refusal the caller can prove
 * happened before the request left us is a RETURN of `refunded`; anything
 * thrown is treated as "the request may have left", which parks the hold as
 * `uncertain`. Classify inside `fn`, the way `integrations/firecrawl.ts`
 * does — that classification is the difference between refunding a user
 * honestly and handing back money we already spent.
 */
export type PaidWork<R> =
  | {
      outcome: "billed";
      result: R;
      /** What the provider says it actually charged. Absent means "the worst
       *  case was right"; a member smaller than the reservation is refunded. */
      actualUnits?: ProviderUnits;
      /** A short, stable pointer to the stored result, replayed to the caller
       *  when a settled operation is retried. */
      resultRef?: string;
      /** The provider's own receipt id, kept server-side for reconciliation. */
      providerReference?: string;
    }
  | { outcome: "refunded"; reason: RefundReason }
  | { outcome: "uncertain"; providerReference?: string };

/** The three outcomes of PLAN §6, made explicit in the wrapper's type. */
export type PaidCallOutcome<R> =
  | {
      kind: "billed";
      replayed: false;
      result: R;
      credits: number;
      providerUnits: ProviderUnits;
      operationKey: string;
      operationId: Id<"providerOperations">;
    }
  | {
      kind: "billed";
      replayed: true;
      /** A billed upstream step is never re-bought: the caller re-reads what
       *  this points at instead of paying for the work again. */
      resultRef: string | null;
      credits: number;
      providerUnits: ProviderUnits;
      operationKey: string;
      operationId: Id<"providerOperations">;
    }
  | {
      kind: "refunded";
      replayed: boolean;
      reason: RefundReason;
      operationKey: string;
      /** `null` when the call was refused before any record existed. */
      operationId: Id<"providerOperations"> | null;
    }
  | {
      kind: "uncertain";
      hold: {
        operationKey: string;
        operationId: Id<"providerOperations">;
        credits: number;
        providerUnits: ProviderUnits;
      };
    };

export const OPERATION_KEY_MAX = 150;

/**
 * Namespace the caller's key with the action. Two things depend on it: an
 * operation key reused across actions can never collide, and the action a
 * usage row belongs to is readable back from the key — which is how the
 * Usage tab labels a line without storing a provider name anywhere.
 *
 * The caller's half may contain anything, `:` included; only the FIRST colon
 * separates the action, so a composite key like `<prospectId>:<step>` stays
 * readable.
 */
export function composeOperationKey(action: PaidAction, key: string): string {
  const caller = boundedString(key, "operationKey", {
    min: 1,
    max: OPERATION_KEY_MAX,
  });
  return `${action}:${caller}`;
}

/** The action a stored operation key belongs to, or `null` for a key written
 *  by something other than the credit wrapper. */
export function actionOfOperationKey(operationKey: string): PaidAction | null {
  const action = operationKey.slice(0, operationKey.indexOf(":"));
  return (PAID_ACTIONS as readonly string[]).includes(action)
    ? (action as PaidAction)
    : null;
}

export function providerOfAction(action: PaidAction): ProviderKind {
  return ACTION_PRICES[action].provider;
}

/**
 * Drop absent and zero members and refuse anything that is not a
 * non-negative integer count of provider units.
 */
export function normalizeUnits(units: ProviderUnits | undefined): ProviderUnits {
  const normalized: ProviderUnits = {};
  if (units === undefined) {
    return normalized;
  }
  for (const [metric, value] of Object.entries(units)) {
    if (value === undefined) {
      continue;
    }
    if (!Number.isInteger(value) || value < 0) {
      throw invalid(`${metric} units must be a non-negative integer`);
    }
    if (value > 0) {
      normalized[metric as TrialMeteredMetric] = value;
    }
  }
  return normalized;
}

/**
 * The backend receipt for one paid call — what we billed the workspace and
 * what the provider says it charged, so our ledger and the provider's
 * invoice stay separately auditable. Server-side only; it is never returned
 * to a client, which is why naming the provider here is allowed.
 */
export function paidCallReceipt(args: {
  provider: ProviderKind;
  action: PaidAction;
  credits: number;
  units: ProviderUnits;
  providerReference?: string;
}): string {
  const units = Object.entries(args.units)
    .map(([metric, value]) => `${metric}=${value}`)
    .join(",");
  const tail =
    args.providerReference === undefined ? "" : `;ref=${args.providerReference}`;
  return `${args.provider}:${args.action};credits=${args.credits};units=${units || "none"}${tail}`.slice(
    0,
    400,
  );
}
