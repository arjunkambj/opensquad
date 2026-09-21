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
 * NOT every throw is a failed call. In `ai@7` a schema-constrained generation
 * is parsed INSIDE `generateText` (`parseCompleteOutput` is awaited in its own
 * body), so a generation that completed and then answered off-shape arrives
 * here as a `NoObjectGeneratedError` rather than as a returned value. The
 * tokens for it are gone, which is why it gets its own outcome instead of
 * being swept in with the failures.
 *
 * A failure BEFORE the request leaves the process — the deployment's gateway
 * token cannot be minted — is not classified here at all, because by the time
 * the SDK hands it back it cannot be told apart from a dropped connection: a
 * plain `Error` thrown from the provider's `fetch` is returned unchanged by
 * `handleFetchError`, so it is not even an `APICallError`. `ai/run.ts` mints
 * that token itself before the loop instead, which turns "nothing left us"
 * into a fact it can prove and refund on.
 *
 * Provider and gateway wording stops here (PLAN §4 white-label): what leaves
 * this module is a `RefundReason` or a `DomainErrorCode` plus a message built
 * from the status code alone — never the provider's own text.
 */
import { APICallError, NoObjectGeneratedError, RetryError } from "ai";
import type { LanguageModelUsage } from "ai";
import type { RefundReason } from "../billing/paidCall";
import type { DomainErrorCode } from "../lib/validators";

export type GatewayFailure =
  /** Answered before generating: nothing was spent. */
  | { kind: "refunded"; reason: RefundReason }
  /**
   * A 402: the PLATFORM's gateway funds are gone, which is nobody's org's
   * fault and everybody's problem. Refunded in full like any other pre-flight
   * refusal, and it trips the platform breaker (PLAN §6).
   */
  | { kind: "platform_exhausted" }
  /**
   * The generation COMPLETED and its answer could not be parsed or did not
   * match the schema. The tokens are spent, so this is BILLED and retried —
   * it is not a failure of the call, only of the answer. `usage` is whatever
   * the error carried; the gateway's own cost is not on it.
   */
  | { kind: "invalid_response"; usage: LanguageModelUsage | undefined }
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
  if (NoObjectGeneratedError.isInstance(cause)) {
    // Thrown from inside `generateText` once the model has already answered:
    // the response could not be parsed, or did not validate against the
    // schema we sent. Billed, and worth one more attempt.
    return { kind: "invalid_response", usage: cause.usage };
  }
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
    return { kind: "platform_exhausted" };
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
