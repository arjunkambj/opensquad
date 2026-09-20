/**
 * What a failed gateway call means for the money (PLAN §6, EXECUTION T03).
 *
 * The one question this file answers: did the request leave us, and did it
 * cost anything? A 4xx is answered in tens of milliseconds, before a single
 * token is generated (spikes §1 recorded both real bodies — an unknown model
 * id and an upstream rejection), so it is REFUNDED. Anything else — a 5xx, a
 * dropped connection, our own deadline — means the outcome is unknown, so the
 * caller throws and the hold parks as `uncertain`. We never hand back money
 * we may have spent.
 *
 * Provider and gateway wording stops here (PLAN §4 white-label): what leaves
 * this module is a `RefundReason` or a `DomainErrorCode` plus a message built
 * from the status code alone — never the provider's own text.
 */
import { APICallError, RetryError } from "ai";
import type { RefundReason } from "../billing/paidCall";
import type { DomainErrorCode } from "../lib/validators";

export type GatewayFailure =
  /** Answered before generating: nothing was spent. */
  | { kind: "refunded"; reason: RefundReason }
  /** Left us, outcome unknown: throw, and let the hold park. */
  | { kind: "unknown"; code: DomainErrorCode; message: string };

/**
 * `PLATFORM_CAPACITY` is the closest code `lib/errors.ts` has for "the shared
 * model service could not answer": it is the one capacity refusal that names
 * no provider and says nothing about who else is using it. A dedicated
 * `PROVIDER_UNAVAILABLE` would read better — that is an integrator change to
 * `lib/errors.ts`, and it is in this task's hand-off.
 */
const GATEWAY_UNAVAILABLE: DomainErrorCode = "PLATFORM_CAPACITY";

/** The error the SDK actually failed on, behind its retry wrapper. */
function rootCause(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!RetryError.isInstance(current)) {
      return current;
    }
    current = current.lastError;
  }
  return current;
}

export function classifyGatewayError(error: unknown): GatewayFailure {
  const cause = rootCause(error);
  if (!APICallError.isInstance(cause)) {
    // No HTTP answer at all: a dropped connection, an abort, our deadline.
    return {
      kind: "unknown",
      code: GATEWAY_UNAVAILABLE,
      message: "ai gateway call did not complete",
    };
  }
  const status = cause.statusCode;
  if (status === 401 || status === 403) {
    return { kind: "refunded", reason: "unauthorized" };
  }
  if (status === 402) {
    return { kind: "refunded", reason: "platform_capacity" };
  }
  if (status === 429) {
    return { kind: "refunded", reason: "rate_limited" };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    // An unknown model id or an upstream rejection: the gateway answers 400
    // before a single token is generated (spikes §1).
    return { kind: "refunded", reason: "validation" };
  }
  return {
    kind: "unknown",
    code: GATEWAY_UNAVAILABLE,
    message: `ai gateway answered ${status === undefined ? "no status" : String(status)}`,
  };
}
