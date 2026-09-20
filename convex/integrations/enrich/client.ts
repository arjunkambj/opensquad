/**
 * The lead-data provider's REST transport — the only place in the codebase
 * that opens a socket to Enrich (PLAN §4 "Integrations at a glance").
 *
 * Everything above this file speaks our own vocabulary: a request ends in
 * exactly one of three shapes, and the caller's money decision follows from
 * the shape rather than from a status code or a provider sentence.
 *
 *   ok        the provider answered and the envelope parsed.
 *   refused   the provider refused BEFORE doing any work — a validation
 *             error, a bad key, an empty wallet, a rate limit we backed off
 *             from. Nothing was charged, so a paid caller RETURNS `refunded`.
 *   unknown   the request left us and we cannot say what happened — a
 *             timeout, a 5xx, a malformed success body. A paid caller THROWS
 *             so `withCredits` parks the hold as `uncertain` (PLAN §6).
 *
 * Provider wording never leaves this directory: a response body is read only
 * to classify it, and what the caller gets back is one of our own codes
 * (PLAN §4 white-label rule, PLAN §10 "Errors").
 *
 * Retry policy, because the two halves are not the same risk:
 *   - a 429 is a definitive refusal, so it is safe to wait out and retry for
 *     ANY request, including a reveal;
 *   - a 5xx, a timeout or a transport failure may mean the request landed, so
 *     only a request the caller marks `idempotent` is retried. A reveal
 *     submit is never retried from here — a second submit is a second charge.
 */
import type { RefundReason } from "../../billing/paidCall";
import { PLATFORM_PAUSED_ENV, readBooleanEnv } from "../../lib/limits";
import type { OperationErrorCode } from "../../lib/validators";

/** Production, despite the host name (spikes §3). */
const ENRICH_BASE_URL = "https://dev.enrich.so/api/v3";

const ENRICH_API_KEY_ENV = "ENRICH_API_KEY";

/**
 * An explicit agent string. The provider sits behind a bot filter that
 * answers 403 to a default HTTP-library agent (spikes §3 "still open"), and a
 * named agent is also what lets their support correlate our traffic.
 */
const ENRICH_USER_AGENT = "OpenIntent/1.0 (+https://openintent.app)";

const REQUEST_TIMEOUT_MS = 20_000;

/** One original attempt plus two retries. */
const MAX_ATTEMPTS = 3;

const BACKOFF_BASE_MS = 500;

const BACKOFF_MAX_MS = 4_000;

/**
 * A `Retry-After` longer than this is not waited out inside an action — the
 * caller is refused instead, so a request cannot sit on an action's clock.
 */
const RETRY_AFTER_MAX_MS = 15_000;

/** How much of an error body is read to classify it. Never stored. */
const ERROR_BODY_SCAN_MAX = 600;

/**
 * Why the provider refused before doing any work. Each member maps to one of
 * `billing/paidCall.ts`'s refund reasons, so a paid caller can hand the money
 * back with a reason the UI already has copy for.
 */
export type EnrichRefusal =
  | "validation"
  | "unauthorized"
  | "insufficient_credits"
  | "rate_limited"
  | "not_found"
  | "kill_switch"
  | "not_configured";

/** Why the outcome is unknown. Maps to our stored failure vocabulary. */
export type EnrichUnknown =
  | "timeout"
  | "provider_unavailable"
  | "invalid_response"
  | "unknown";

export type EnrichResult<T> =
  | { kind: "ok"; data: T; requestId?: string }
  | { kind: "refused"; reason: EnrichRefusal }
  | { kind: "unknown"; reason: EnrichUnknown };

/** The refund reason a refusal is handed back to the ledger as. */
export function refundReasonOf(reason: EnrichRefusal): RefundReason {
  switch (reason) {
    case "validation":
      return "validation";
    case "unauthorized":
    case "not_configured":
      return "unauthorized";
    case "insufficient_credits":
      return "insufficient_credits";
    case "rate_limited":
      return "rate_limited";
    case "kill_switch":
      return "kill_switch";
    case "not_found":
      return "validation";
  }
}

/** The stored failure code a refusal or an unknown outcome is recorded as. */
export function operationErrorCodeOf(
  reason: EnrichRefusal | EnrichUnknown,
): OperationErrorCode {
  switch (reason) {
    case "validation":
      return "invalid_response";
    case "unauthorized":
    case "not_configured":
      return "provider_unavailable";
    case "insufficient_credits":
      return "insufficient_credits";
    case "rate_limited":
      return "rate_limited";
    case "kill_switch":
      return "platform_paused";
    case "not_found":
      return "not_found";
    case "timeout":
      return "timeout";
    case "provider_unavailable":
      return "provider_unavailable";
    case "invalid_response":
      return "invalid_response";
    case "unknown":
      return "unknown";
  }
}

/**
 * A caller that must not be retried after the request left us. A reveal
 * submit is `false`: a second submit is a second job and a second charge.
 */
export type EnrichRequest = {
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  /** Safe to repeat after an unknown outcome. Free reads and `count` are. */
  idempotent: boolean;
  /**
   * The kill switch stops every provider call, free ones included (PLAN §6).
   * Only the wallet-balance read opts out, because reading our own balance is
   * what decides whether the breaker should be tripped in the first place.
   */
  respectKillSwitch?: boolean;
};

/**
 * Perform one provider request and classify it. The body is parsed as the
 * documented envelope `{ success, data, meta.requestId }` (spikes §3); a 2xx
 * that does not parse that way is an unknown outcome, not a success.
 */
export async function enrichRequest<T>(
  request: EnrichRequest,
): Promise<EnrichResult<T>> {
  if (request.respectKillSwitch !== false && readBooleanEnv(PLATFORM_PAUSED_ENV)) {
    return { kind: "refused", reason: "kill_switch" };
  }
  const apiKey = process.env[ENRICH_API_KEY_ENV];
  if (apiKey === undefined || apiKey.trim() === "") {
    // A deployment mistake, not a provider verdict: nothing left this
    // deployment, so a paid caller refunds rather than holding the money.
    console.error("lead-data client: no API key is configured");
    return { kind: "refused", reason: "not_configured" };
  }

  let lastUnknown: EnrichUnknown = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const attemptResult = await attemptRequest<T>(request, apiKey);
    if (attemptResult.kind !== "retry") {
      return attemptResult;
    }
    lastUnknown = attemptResult.unknown;
    const retryable =
      attemptResult.after !== null &&
      attempt < MAX_ATTEMPTS &&
      (attemptResult.rateLimited || request.idempotent);
    if (!retryable) {
      return attemptResult.rateLimited
        ? { kind: "refused", reason: "rate_limited" }
        : { kind: "unknown", reason: attemptResult.unknown };
    }
    await sleep(attemptResult.after ?? backoffMs(attempt));
  }
  return { kind: "unknown", reason: lastUnknown };
}

type AttemptResult<T> =
  | EnrichResult<T>
  | {
      kind: "retry";
      rateLimited: boolean;
      /** Milliseconds to wait, or `null` when waiting is pointless. */
      after: number | null;
      unknown: EnrichUnknown;
    };

async function attemptRequest<T>(
  request: EnrichRequest,
  apiKey: string,
): Promise<AttemptResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${ENRICH_BASE_URL}${request.path}`, {
      method: request.method,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": ENRICH_USER_AGENT,
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
      signal: controller.signal,
    });
    // `fetch` resolves at the headers; the outcome is not known until the
    // body has arrived too.
    text = await response.text();
  } catch {
    const aborted = controller.signal.aborted;
    return {
      kind: "retry",
      rateLimited: false,
      after: backoffMs(1),
      unknown: aborted ? "timeout" : "unknown",
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    const after = retryAfterMs(response);
    return {
      kind: "retry",
      rateLimited: true,
      after,
      unknown: "provider_unavailable",
    };
  }
  if (response.status >= 500) {
    return {
      kind: "retry",
      rateLimited: false,
      after: backoffMs(1),
      unknown: "provider_unavailable",
    };
  }
  if (!response.ok) {
    return { kind: "refused", reason: refusalOf(response.status, text) };
  }

  const parsed = parseEnvelope<T>(text);
  return parsed === null
    ? { kind: "unknown", reason: "invalid_response" }
    : parsed;
}

/**
 * Which refusal a 4xx is. The three documented error bodies (problem JSON,
 * `{ error }` on auth, `{ statusCode, error, message, retryAfter }` on 429 —
 * spikes §3) are read only to tell an empty wallet from a bad filter; the
 * text itself is dropped here and never stored.
 */
function refusalOf(status: number, body: string): EnrichRefusal {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 402) {
    return "insufficient_credits";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status === 400 || status === 422) {
    // A 402 is documented on `/search`, but an insufficient-credit answer has
    // also been seen inside a 400 body on other routes; reading the scanned
    // prefix keeps the refund reason honest either way.
    return /insufficient credits/i.test(body.slice(0, ERROR_BODY_SCAN_MAX))
      ? "insufficient_credits"
      : "validation";
  }
  return "validation";
}

/** The documented success envelope, or `null` when the body is not one. */
function parseEnvelope<T>(text: string): EnrichResult<T> | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const envelope = body as {
    success?: unknown;
    data?: unknown;
    meta?: { requestId?: unknown };
  };
  if (envelope.success !== true || envelope.data === undefined) {
    return null;
  }
  const requestId = envelope.meta?.requestId;
  return {
    kind: "ok",
    data: envelope.data as T,
    ...(typeof requestId === "string" ? { requestId } : {}),
  };
}

/**
 * The provider's own wait, in milliseconds, or `null` when it is longer than
 * an action should hold. `Retry-After` is documented in seconds and is also
 * echoed in the 429 body as `retryAfter`; the header is authoritative.
 */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return backoffMs(1);
  }
  const ms = seconds * 1_000;
  return ms > RETRY_AFTER_MAX_MS ? null : ms;
}

/** Exponential back-off with a ceiling — bounded, so an action cannot stall. */
function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
