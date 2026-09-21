/**
 * OpenSquad ↔ AgentMail boundary (P05 — transport-only spike).
 *
 * Two narrow responsibilities (plan/integrations.md §G3):
 *
 * 1. INBOUND — the registered `@agentmail/convex` component owns verified,
 *    `event_id`-deduplicated webhook ingestion and inbound message storage.
 *    `agentmailForWebhookSecret` creates a client for the per-org route at
 *    POST /agentmail/webhook/<token>. `onEvent` and
 *    `onMessageReceived` are the app-side internal mutations the component
 *    dispatches through its callback pool.
 *
 * 2. OUTBOUND — `executeSendAttempt` is THE dispatch boundary: exactly one
 *    `fetch` to `POST /v0/inboxes/{inbox_id}/messages/send` with the durable
 *    idempotency key in the HTTP `Idempotency-Key` request header — never in
 *    the body's `headers` field, which means RFC 5322 email headers.
 *
 *    The component's own `sendMessage`/`replyToMessage`/`forwardMessage` are
 *    NOT used for approved sends: they enqueue into a retrying Workpool
 *    (default 5 attempts, 30 s initial backoff, base 2) whose fetch helper
 *    attaches no idempotency key and offers no application preflight hook,
 *    and `cancelSend` cannot retract a request already in flight (verified
 *    against @agentmail/convex@0.1.0: dist/component/lib.js performSend /
 *    enqueueSend / cancelSend and dist/component/utils.js agentmailFetch).
 *
 * Visibility: every function here is internal — unreachable from clients and
 * from public HTTP. Sales-side persistence (send attempts, conversations,
 * drafts, workflow signalling) is P10/P11 on the P02 schema; this file fixes
 * the transport contract and documents what those tasks must persist.
 */

import { AgentMail } from "@agentmail/convex";
import { v, type Infer } from "convex/values";
import { components, internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { recordQuarantinedEvent, syntheticRef } from "../inbox/quarantine";
import { upsertMessage } from "../inbox/model";
import { recordReceipt } from "../outreach/sendReceipts";
import {
  agentmailBaseUrl,
  extractEventIds,
  getMessage,
} from "./agentmailApi";
import { decryptSecret } from "../lib/secrets";
import {
  canonicalJson,
  domainError,
  evaluateOptOutText,
  inboundApplicationKey,
  outboundApplicationKey,
  parseInboundSender,
  PROVIDER_REF_MAX_LENGTH,
  sha256Hex,
} from "../lib/validators";
import type { QuarantineReason } from "../lib/validators";

/**
 * The component's app-side callbacks — the only configuration that is the same
 * for every org.
 */
const COMPONENT_CALLBACKS = {
  // The cast covers one place where the component contradicts itself: its
  // runtime event validator makes `thread` OPTIONAL
  // (`shared.d.ts`: `thread: VAny<any, "optional", string>`) while this
  // callback's declared type makes it REQUIRED. Honouring the type loses mail —
  // a verified `message.received` with no thread object throws
  // ArgumentValidationError in a Workpool that does not retry mutations, and
  // the component's `by_eventId` ledger then refuses the provider's resend.
  // `onMessageReceived` accepts the runtime shape and never reads the field.
  onMessageReceived:
    internal.integrations.agentmail.onMessageReceived as unknown as NonNullable<
      ConstructorParameters<typeof AgentMail>[1]
    >["onMessageReceived"],
  onEvent: internal.integrations.agentmail.onEvent,
} as const;

/**
 * A per-request component handle bound to ONE org's webhook secret
 * (PLAN §4 step 4). Constructed per inbound request so the component's Svix
 * verification, `event_id` dedupe and message storage are reused unchanged
 * without any shared credential.
 */
export function agentmailForWebhookSecret(webhookSecret: string): AgentMail {
  return new AgentMail(components.agentmail, {
    ...COMPONENT_CALLBACKS,
    webhookSecret,
  });
}

/**
 * The org's own AgentMail key, decrypted inside this action.
 *
 * There is no platform key any more: every outbound request is made with the
 * key its org pasted. An org with no usable key is a configuration
 * refusal, not a provider verdict — it throws, so no send attempt records an
 * outcome for a request that was never made.
 */
async function orgApiKey(
  ctx: ActionCtx,
  orgId: Id<"orgs">,
): Promise<string> {
  const envelope = await ctx.runQuery(internal.orgs.secrets.getEnvelope, {
    orgId,
    provider: "agentmail" as const,
  });
  if (envelope === null) {
    throw domainError(
      "FORBIDDEN",
      "this organization has no connected mail key",
    );
  }
  if (envelope.status === "invalid") {
    throw domainError(
      "FORBIDDEN",
      "this organization's mail key was refused by the provider — reconnect the inbox",
    );
  }
  return await decryptSecret(envelope);
}

/**
 * A 401 at send time is a connection fact, not a send fact (PLAN §4 step 7):
 * the key flips to `invalid` and the org's automation pauses with the
 * reconnect reason. Recorded before the attempt's own outcome is returned, so
 * the banner is up by the time the failure is shown.
 */
async function noteUnauthorized(
  ctx: ActionCtx,
  orgId: Id<"orgs">,
  result: SendAttemptResult,
): Promise<void> {
  // A 401 is now classified `retryable` rather than `rejected` — the request
  // was not processed and the same email may go out once the key is fixed —
  // so this reads the STATUS, which is the fact it was always about.
  if (result.outcome === "accepted" || result.httpStatus !== 401) {
    return;
  }
  await ctx.runMutation(internal.inbox.connectionState.markInboxKeyInvalid, {
    orgId,
    reason: "provider_rejected_key_at_send",
  });
}

// ---------------------------------------------------------------------------
// Outbound: the narrow send adapter
// ---------------------------------------------------------------------------

const SEND_REQUEST_TIMEOUT_MS = 30_000;
const PROVIDER_ERROR_BODY_LIMIT = 1024;
const SEND_TIMEOUT_MARKER = "opensquad.agentmail.send_timeout";

/**
 * Exact AgentMail REST body for POST /v0/inboxes/{inbox_id}/messages/send.
 * The approving transaction (P10) stores this object immutably and passes it
 * here unchanged so a reconciliation replay is bit-identical.
 *
 * `headers` are RFC 5322 email headers (e.g. `References`). The HTTP
 * `Idempotency-Key` is set by the transport below and must never be placed
 * in this object.
 */
const vSendRequestBody = v.object({
  to: v.union(v.string(), v.array(v.string())),
  subject: v.optional(v.string()),
  text: v.optional(v.string()),
  html: v.optional(v.string()),
  cc: v.optional(v.union(v.string(), v.array(v.string()))),
  bcc: v.optional(v.union(v.string(), v.array(v.string()))),
  reply_to: v.optional(v.union(v.string(), v.array(v.string()))),
  labels: v.optional(v.array(v.string())),
  headers: v.optional(v.record(v.string(), v.string())),
  attachments: v.optional(
    v.array(
      v.object({
        filename: v.string(),
        content: v.string(),
        content_type: v.optional(v.string()),
      }),
    ),
  ),
});

type SendRequestBody = Infer<typeof vSendRequestBody>;

/**
 * Result of one provider request. Three honest outcomes — "accepted" is
 * provider acknowledgement ("Sent") only; it is never "Delivered" (G3 step 9:
 * delivery is established solely by verified webhook events).
 */
const vSendAttemptResult = v.union(
  v.object({
    outcome: v.literal("accepted"),
    messageId: v.string(),
    threadId: v.string(),
    httpStatus: v.number(),
  }),
  v.object({
    outcome: v.literal("rejected"),
    httpStatus: v.number(),
    providerError: v.string(),
  }),
  v.object({
    // The provider did NOT process this request, and saying so again later
    // may well work: rate limiting, and a key that was invalid at this
    // instant. Distinct from `rejected`, which forecloses the draft forever,
    // and from `uncertain`, which blocks the conversation until a human
    // reconciles it (PLAN §9.1: 429/5xx retried with capped back-off, an
    // invalid key pauses the agent with nothing dropped).
    outcome: v.literal("retryable"),
    reason: v.union(
      v.literal("rate_limited"),
      v.literal("unauthorized"),
    ),
    httpStatus: v.number(),
    /** Honoured from `Retry-After` when the provider sent one, in ms. */
    retryAfterMs: v.optional(v.number()),
    detail: v.string(),
  }),
  v.object({
    outcome: v.literal("uncertain"),
    reason: v.union(
      v.literal("timeout"),
      v.literal("transport_error"),
      v.literal("http_5xx"),
      v.literal("idempotency_conflict"),
      v.literal("malformed_response"),
    ),
    httpStatus: v.optional(v.number()),
    detail: v.string(),
  }),
);

type SendAttemptResult = Infer<typeof vSendAttemptResult>;

/**
 * Exactly one POST to AgentMail. No retry, no SDK, no workpool — a second
 * attempt is an explicit reconciliation decision, never this function's.
 *
 * Outcome semantics (G3 steps 5–9, architecture §8 "Send preflight and
 * submission"):
 * - `accepted` — 2xx with a JSON body carrying non-empty `message_id` and
 *   `thread_id`. The caller stores those immutable provider references.
 * - `rejected` — a definitive 4xx refusal other than 409. The provider did
 *   not accept this request; it can never result in mail from this request.
 *   Whether a corrected draft/attempt may follow is an application decision.
 * - `uncertain` — timeout, transport failure, 5xx, 409 idempotency conflict,
 *   or a malformed/empty success response. The request may or may not have
 *   been processed. The attempt stays unresolved; nothing here may issue
 *   another request or mint a fresh key.
 */
async function performSingleSendRequest(args: {
  /** The org's own decrypted key — never `process.env`. */
  apiKey: string;
  inboxId: string;
  idempotencyKey: string;
  payload: SendRequestBody;
  /**
   * P10: the exact REST path relative to the inbox — `messages/send` for
   * first contact, `messages/{parent}/reply` for an in-thread reply. Both
   * honor the same `Idempotency-Key` header semantics (the reply endpoint
   * was verified live in the P05 probe).
   */
  endpointOperation: "send" | "reply";
  /** Parent provider message id — required iff `endpointOperation` is
   *  "reply". URL-encoded into the path. */
  parentMessageId?: string;
}): Promise<SendAttemptResult> {
  const apiKey = args.apiKey;
  const baseUrl = agentmailBaseUrl();
  // Provider IDs are opaque path segments, including email-address inbox
  // IDs and RFC 5322 message IDs — always URL-encode them.
  const path =
    args.endpointOperation === "reply"
      ? `messages/${encodeURIComponent(args.parentMessageId ?? "")}/reply`
      : "messages/send";
  const url = `${baseUrl}/inboxes/${encodeURIComponent(args.inboxId)}/${path}`;

  let response: Response | undefined;
  let responseText: string;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(SEND_TIMEOUT_MARKER)),
    SEND_REQUEST_TIMEOUT_MS,
  );
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Provider idempotency lives in the HTTP request headers. The body
        // field `headers` is email headers and is NOT a substitute (G3).
        "Idempotency-Key": args.idempotencyKey,
      },
      body: JSON.stringify(stripUndefined(args.payload)),
      signal: controller.signal,
    });
    // fetch resolves at the headers. Keep the deadline and uncertainty
    // handling active until the acknowledgement body has also arrived.
    responseText = await response.text();
  } catch (error) {
    // Aborted/timed-out or network-failed request: it may or may not have
    // reached AgentMail. Never resend from here.
    const isTimeout = controller.signal.aborted;
    // The thrown error's own text is logged, never returned: it names the
    // provider's host and can carry its wording, and this value is stored on
    // the attempt and shown in the activity feed.
    console.info("agentmail.send transport failure", {
      reason: isTimeout ? "timeout" : "transport_error",
      detail:
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return {
      outcome: "uncertain",
      reason: isTimeout ? "timeout" : "transport_error",
      httpStatus: response?.status,
      detail: isTimeout
        ? "The mail provider did not answer in time, so it is not known whether this email was sent."
        : "We could not reach the mail provider, so it is not known whether this email was sent.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 409) {
    // AgentMail idempotency semantics: replaying a key with a DIFFERENT body
    // conflicts. A 409 therefore proves the provider already holds a record
    // for this key — an earlier request arrived. What it holds and whether it
    // delivered is unknown to us here: uncertain, investigate via provider
    // reads; never resolve by minting a fresh key.
    logProviderRefusal(response.status, responseText);
    return {
      outcome: "uncertain",
      reason: "idempotency_conflict",
      httpStatus: response.status,
      detail: sendFailureMessage(response.status),
    };
  }

  if (response.status >= 500) {
    // A 5xx is not a definitive refusal — the provider may have accepted the
    // message before failing. Per architecture §8.8 this is never a
    // "definitively safe retry"; it is uncertain.
    logProviderRefusal(response.status, responseText);
    return {
      outcome: "uncertain",
      reason: "http_5xx",
      httpStatus: response.status,
      detail: sendFailureMessage(response.status),
    };
  }

  if (response.status === 429 || response.status === 401) {
    // NOT TERMINAL, AND NOT UNCERTAIN.
    //
    // A 429 means the provider declined to process this request at all, and a
    // 401 means it declined the credentials — in both cases no mail was sent,
    // and in both cases the same request may succeed later (the rate window
    // moves; a rotating key is stored seconds afterwards). Folding them into
    // "definitively refused" recorded the attempt `definitively_failed`, and
    // `sendReserve` then refuses every further attempt on that draft revision
    // — so an approved email was lost to a burst or to a key rotation and
    // could only be sent by editing the draft. PLAN §9.1 says the opposite:
    // 429/5xx are retried with capped back-off, and an invalid key pauses the
    // agent with NOTHING dropped.
    logProviderRefusal(response.status, responseText);
    return {
      outcome: "retryable",
      reason: response.status === 429 ? "rate_limited" : "unauthorized",
      httpStatus: response.status,
      ...(response.status === 429
        ? retryAfterMs(response.headers.get("retry-after"))
        : {}),
      detail: sendFailureMessage(response.status),
    };
  }

  if (!response.ok) {
    // Remaining 4xx: the provider definitively refused this request.
    logProviderRefusal(response.status, responseText);
    return {
      outcome: "rejected",
      httpStatus: response.status,
      providerError: sendFailureMessage(response.status),
    };
  }

  // 2xx: only meaningful if it carries the provider's immutable IDs. An empty
  // or malformed success body is treated like a lost acknowledgement.
  let body: unknown;
  try {
    body = responseText.length > 0 ? JSON.parse(responseText) : null;
  } catch {
    return {
      outcome: "uncertain",
      reason: "malformed_response",
      httpStatus: response.status,
      detail:
        "The mail provider's answer could not be read, so it is not known whether this email was sent.",
    };
  }
  if (!isSendAcceptedBody(body)) {
    return {
      outcome: "uncertain",
      reason: "malformed_response",
      httpStatus: response.status,
      detail:
        "The mail provider accepted this email without returning its identifiers, so it is not known whether it was sent.",
    };
  }
  return {
    outcome: "accepted",
    messageId: body.message_id,
    threadId: body.thread_id,
    httpStatus: response.status,
  };
}

function isSendAcceptedBody(
  body: unknown,
): body is { message_id: string; thread_id: string } {
  const record = asRecord(body);
  return (
    record !== null &&
    typeof record.message_id === "string" &&
    record.message_id.length > 0 &&
    typeof record.thread_id === "string" &&
    record.thread_id.length > 0
  );
}

/**
 * The provider's own words, to the SERVER LOG and nowhere else.
 *
 * PLAN §6 and `convex/README.md`: provider error text never leaves
 * `integrations/`. It used to be returned as `providerError`/`detail`, stored
 * verbatim on `sendAttempts.error.message` and copied into
 * `activityEvents.summary` — which `activity/queries.ts` returns to the
 * client, so the provider's name and wording reached the screen. The status is
 * mapped to OUR sentence instead, and the body is logged here for an operator.
 */
function logProviderRefusal(status: number, text: string): void {
  console.info("agentmail.send refused", {
    status,
    body:
      text.length > PROVIDER_ERROR_BODY_LIMIT
        ? `${text.slice(0, PROVIDER_ERROR_BODY_LIMIT)}…[truncated]`
        : text,
  });
}

/**
 * OUR sentence for a provider status, white-label and safe to store.
 *
 * Deliberately says what happened to the EMAIL, because that is what the
 * activity feed and the thread are about — and never names the provider.
 */
function sendFailureMessage(status: number): string {
  if (status === 401) {
    // Classified `retryable`: the key may be mid-rotation, and reconnecting
    // unpauses the organization, at which point this email goes out.
    return "The mail key was refused, so this email was not sent. Reconnect the inbox and it will be retried.";
  }
  if (status === 403) {
    // A definitive refusal, not a retryable one: the key is real and simply
    // may not use this inbox, which no amount of waiting changes.
    return "The connected mail key is not allowed to send from this inbox, so this email was not sent.";
  }
  if (status === 404) {
    return "The sending inbox or the message being replied to no longer exists, so this email was not sent.";
  }
  if (status === 409) {
    return "An earlier attempt to send this email already reached the mail provider; what it did with it is being checked.";
  }
  if (status === 422 || status === 400) {
    return "The mail provider refused this email's contents. Edit the draft and try again.";
  }
  if (status === 429) {
    return "The mail provider is rate limiting this account, so this email was not sent yet. It will be retried.";
  }
  if (status >= 500) {
    return "The mail provider had a problem, so it is not known whether this email was sent.";
  }
  return "The mail provider refused this email.";
}

/**
 * `Retry-After` as milliseconds, honoured when the provider sends one.
 *
 * Both documented forms are accepted (delay-seconds and an HTTP date), and an
 * absurd value is clamped rather than trusted: a header saying "come back in a
 * week" must not park an approved email for a week.
 */
function retryAfterMs(header: string | null): { retryAfterMs?: number } {
  if (header === null) {
    return {};
  }
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    return {};
  }
  return { retryAfterMs: Math.min(ms, RETRY_AFTER_MAX_MS) };
}

/** The longest back-off a provider header may ask for. */
const RETRY_AFTER_MAX_MS = 60 * 60 * 1000;

function stripUndefined(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    out[key] = stripUndefined(entry);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Provider timestamps arrive as numbers or ISO strings — normalize to ms. */
function numberField(
  record: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * THE dispatch boundary for approved outbound mail (first contact).
 *
 * Caller contract — implemented by P10 (G3 steps 3–4, architecture §8): one
 * Convex transaction immediately before this action validates the approved
 * draft revision, org/campaign status, suppression, allowed demo
 * recipient, conversation version, takeover state and rate allowance, and
 * confirms no successful or unresolved attempt exists across the
 * conversation's revisions. That transaction durably records the send
 * attempt, this idempotency key, the payload fingerprint, endpoint, inbox
 * and dispatch timestamp, and flips the attempt to `requesting`. The key is
 * generated once per attempt and NEVER regenerated for an unresolved
 * attempt.
 *
 * This action then performs exactly one HTTPS request and returns the
 * outcome for the caller to persist. It performs no retry, no follow-up
 * mutation and no workflow signalling itself. If the caller's recording
 * mutation fails after a successful request (lost acknowledgement), the
 * attempt remains `requesting`/`uncertain` and follows the reconciliation
 * path — it is never resent with a new key.
 *
 * Replies in an existing thread use the same contract against the documented
 * reply endpoint (`POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply`);
 * that extension lands with P10/P11, not in this spike.
 */
export const executeSendAttempt = internalAction({
  args: {
    orgId: v.id("orgs"),
    inboxId: v.string(),
    idempotencyKey: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (ctx, args): Promise<SendAttemptResult> => {
    const result = await performSingleSendRequest({
      ...args,
      apiKey: await orgApiKey(ctx, args.orgId),
      endpointOperation: "send",
    });
    await noteUnauthorized(ctx, args.orgId, result);
    return result;
  },
});

/**
 * Explicit reconciliation replay for an `uncertain` attempt (G3 step 8,
 * architecture §8.7).
 *
 * Replays the EXACT same key and payload: AgentMail returns the original
 * result for an identical request instead of double-sending. This is still a
 * real send — if the original request never arrived, this initiates
 * delivery. Lawful ONLY when the caller's preflight transaction has
 * re-validated, at replay time:
 *
 * - the attempt is `uncertain` — never `requesting`, never already
 *   `accepted`, and covered at most once by a recorded replacement decision;
 * - org policy still permits dispatch (not paused, taken over or
 *   suppressed; conversation version unchanged; send window valid);
 * - the attempt was recorded within the provider's verified idempotency
 *   window (documented as 24 h after completion — confirm by probe before
 *   relying on it).
 *
 * If the key window expired or policy no longer permits, do NOT call this:
 * use provider read APIs (`getMessage`/thread reads) and webhook evidence,
 * and require human review. Never mint a fresh key for an unresolved
 * attempt.
 */
export const reconcileSendAttempt = internalAction({
  args: {
    orgId: v.id("orgs"),
    inboxId: v.string(),
    idempotencyKey: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (ctx, args): Promise<SendAttemptResult> => {
    const result = await performSingleSendRequest({
      ...args,
      apiKey: await orgApiKey(ctx, args.orgId),
      endpointOperation: "send",
    });
    await noteUnauthorized(ctx, args.orgId, result);
    return result;
  },
});

/**
 * P10: the reply variant of the dispatch boundary — exactly one POST to
 * `POST /v0/inboxes/{inbox_id}/messages/{parent_message_id}/reply` with the
 * SAME idempotency-key contract (`endpointOperation: "reply"` on the
 * sendAttempts row). `parentMessageId` is the draft's immutable
 * `replyToMessageRef`; identical replay semantics apply.
 */
export const executeReplyAttempt = internalAction({
  args: {
    orgId: v.id("orgs"),
    inboxId: v.string(),
    idempotencyKey: v.string(),
    parentMessageId: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (ctx, args): Promise<SendAttemptResult> => {
    const result = await performSingleSendRequest({
      ...args,
      apiKey: await orgApiKey(ctx, args.orgId),
      endpointOperation: "reply",
    });
    await noteUnauthorized(ctx, args.orgId, result);
    return result;
  },
});

/** P10: reconciliation replay for an `uncertain` reply attempt — same
 *  key, same payload, same parent, audit-distinct name. */
export const reconcileReplyAttempt = internalAction({
  args: {
    orgId: v.id("orgs"),
    inboxId: v.string(),
    idempotencyKey: v.string(),
    parentMessageId: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (ctx, args): Promise<SendAttemptResult> => {
    const result = await performSingleSendRequest({
      ...args,
      apiKey: await orgApiKey(ctx, args.orgId),
      endpointOperation: "reply",
    });
    await noteUnauthorized(ctx, args.orgId, result);
    return result;
  },
});

/**
 * The full inbound message, fetched from the provider with the ORG's own key.
 *
 * WHY THE WEBHOOK PAYLOAD IS NOT ENOUGH. The provider documents that a payload
 * over 1 MB omits `text` and `html` entirely and tells integrators to fetch
 * the message after receiving the webhook; the REST `Message` also carries
 * `headers`, which the delivery envelope is not guaranteed to. So a large
 * reply used to reach classification with an empty body
 * (`failed:no_message_text`), an HTML-only reply the same way, an unsubscribe
 * phrase in an omitted body was never seen, and every header-based bounce and
 * auto-reply rule quietly fell back to phrase matching.
 *
 * Read-only and free: the provider meters sends, not reads (PLAN §6), so this
 * is NOT a paid call and the free rule path stays free — an unsubscribe is
 * still honoured with the org at zero credits and the kill switch on.
 *
 * Returns OUR vocabulary only: a bounded projection or a mapped failure code.
 * Provider wording never leaves this module (PLAN §6, `convex/README.md`).
 */
export const fetchInboundMessage = internalAction({
  args: {
    orgId: v.id("orgs"),
    inboxId: v.string(),
    messageId: v.string(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      message: v.object({
        subject: v.optional(v.string()),
        from: v.optional(v.string()),
        preview: v.optional(v.string()),
        text: v.optional(v.string()),
        extractedText: v.optional(v.string()),
        html: v.optional(v.string()),
        extractedHtml: v.optional(v.string()),
        headers: v.optional(v.record(v.string(), v.string())),
      }),
    }),
    v.object({ ok: v.literal(false), code: v.string() }),
  ),
  handler: async (ctx, args) => {
    let apiKey: string;
    try {
      apiKey = await orgApiKey(ctx, args.orgId);
    } catch {
      // No key, or one the provider already refused. That is a connection
      // fact the banner already carries; here it is simply "no body to read".
      return { ok: false as const, code: "no_key" };
    }
    const result = await getMessage(apiKey, args.inboxId, args.messageId);
    if (!result.ok) {
      return { ok: false as const, code: result.code };
    }
    const message = result.value;
    return {
      ok: true as const,
      message: {
        ...(message.subject !== undefined ? { subject: message.subject } : {}),
        ...(message.from !== undefined ? { from: message.from } : {}),
        ...(message.preview !== undefined ? { preview: message.preview } : {}),
        ...(message.text !== undefined ? { text: message.text } : {}),
        ...(message.extractedText !== undefined
          ? { extractedText: message.extractedText }
          : {}),
        ...(message.html !== undefined ? { html: message.html } : {}),
        ...(message.extractedHtml !== undefined
          ? { extractedHtml: message.extractedHtml }
          : {}),
        ...(message.headers !== undefined ? { headers: message.headers } : {}),
      },
    };
  },
});

/**
 * The provider's own timestamp for an event, read from the sub-object that
 * carries it.
 *
 * One payload key per event type (`plan/spikes.md` "Webhook delivery
 * envelope"), and the envelope itself carries no top-level `timestamp` — so
 * the keys are tried in the same order `extractEventIds` tries them, and the
 * envelope is read only as a last resort in case a future event type puts it
 * there.
 */
function eventPayloadTimestamp(
  event: Record<string, unknown> | null,
): number | undefined {
  for (const key of [
    "message",
    "send",
    "delivery",
    "bounce",
    "complaint",
    "reject",
    "open",
  ]) {
    const payload = asRecord(event?.[key]);
    const timestamp = numberField(payload, "timestamp");
    if (timestamp !== undefined) {
      return timestamp;
    }
  }
  return numberField(event, "timestamp");
}

/**
 * THE rule both callbacks below obey: **never throw**.
 *
 * `@convex-dev/workpool` does not retry mutations, and the component's
 * `event_id` ledger means a provider resend of the same event returns before
 * enqueueing anything. So a deterministic throw here — a rejected validator,
 * a `ConvexError`, a `.unique()` that met two rows — loses the verified event
 * permanently with nothing left to replay. Every guard in this section exists
 * to turn a would-be throw into a logged `return null`.
 */

/** Longest `emailEventReceipts.applicationKey` `recordReceipt` accepts. */
const APPLICATION_KEY_MAX_LENGTH = 500;

/**
 * A provider identifier, trimmed and proven to fit the bound `recordReceipt`
 * enforces with `boundedString` — which THROWS. Checking here instead means an
 * over-long or blank id degrades to a dropped-and-logged event rather than a
 * lost one.
 */
function providerRef(
  value: string | undefined,
  max: number = PROVIDER_REF_MAX_LENGTH,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > max ? undefined : trimmed;
}

/**
 * A key for an envelope that carried no identifier of its own — a digest of
 * the envelope itself, so a provider resend of the same payload dedupes onto
 * the row it already wrote. Never throws (the rule at the top of this
 * section).
 *
 * THE FALLBACK IS DETERMINISTIC TOO. A clock read here would mint a DIFFERENT
 * key for each delivery of one event, which is precisely the duplication this
 * digest exists to prevent: the quarantine dedupes on `providerEventId`, so
 * two deliveries would leave two rows and the scheme would silently stop
 * working exactly when the payload is at its strangest. When canonical JSON or
 * the hash refuses the value, the seed falls back to a bounded, order-stable
 * description of the envelope's own shape — the same value for the same
 * payload, every time — matching the route-side twin in `inboundRoute.ts`,
 * which seeds from the `svix-id` or a digest of the raw body and never from
 * the clock.
 */
async function envelopeDigest(event: unknown): Promise<string> {
  try {
    return await sha256Hex(canonicalJson(event));
  } catch {
    // Nothing here may throw, so every step is guarded in turn.
    try {
      return await sha256Hex(describeEnvelope(event));
    } catch {
      return `shape:${describeEnvelope(event).slice(0, 100)}`;
    }
  }
}

/** Longest shape description `describeEnvelope` produces. */
const ENVELOPE_SHAPE_MAX_LENGTH = 400;

/**
 * A stable, bounded description of a value `canonicalJson` could not
 * serialize: its type, and — for an object — its own keys in sorted order with
 * each value's type. It identifies the delivery well enough to dedupe a
 * resend, and it is a pure function of the payload, never of the clock.
 */
function describeEnvelope(event: unknown): string {
  const describe = (value: unknown, depth: number): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) {
      return depth === 0
        ? `array(${value.length})`
        : `[${value.map((entry) => describe(entry, depth - 1)).join(",")}]`;
    }
    if (typeof value !== "object") {
      return typeof value === "string"
        ? `string(${value.length})`
        : String(typeof value);
    }
    if (depth === 0) {
      return "object";
    }
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${key}:${describe((value as Record<string, unknown>)[key], depth - 1)}`,
      )
      .join(",")}}`;
  };
  return describe(event, 3).slice(0, ENVELOPE_SHAPE_MAX_LENGTH);
}

/**
 * Hold a verified event whose envelope named no inbox, no message or no event
 * id — the shared body of both callbacks' "we could not key this" branch.
 *
 * `providerEventId` is the quarantine's dedupe key, so a minted one has to be
 * unique PER EVENT: seeded from the message or the inbox — values every event
 * for that mailbox shares — distinct events would collide on one row and every
 * one after the first would be dropped. A digest of the envelope is the only
 * seed that identifies THIS delivery while still deduping a resend of it, and
 * it is the same key the route-side twin mints (`inboundRoute.ts`).
 *
 * The row is evidence, not a replayable event: `quarantine.replayOne`
 * recognises `event_unparseable` and the minted refs, and never replays them.
 */
async function quarantineUnparseableEvent(
  ctx: MutationCtx,
  args: {
    /** Whatever the callback was handed — the seed for the minted keys. */
    event: unknown;
    eventId: string | undefined;
    inboxRef: string | undefined;
    messageRef: string | undefined;
    threadRef?: string;
    eventType: string | undefined;
    providerTimestamp?: number;
    note: string;
  },
): Promise<void> {
  const seed =
    args.eventId === undefined ? await envelopeDigest(args.event) : args.eventId;
  // The message and inbox stand-ins are labels on the row rather than keys, so
  // they may lean on whatever the envelope did carry.
  const refSeed = args.messageRef ?? args.inboxRef ?? seed;
  const inboxRef = args.inboxRef ?? syntheticRef("inbox", refSeed);
  const messageRef = args.messageRef ?? syntheticRef("message", refSeed);
  const eventType = args.eventType ?? "unknown";
  await recordQuarantinedEvent(ctx, {
    inboxRef,
    providerEventId: args.eventId ?? syntheticRef("event", seed),
    // The key states which half of the mail path the row belongs to, and
    // `recordReceipt` derives `direction` from exactly this prefix.
    applicationKey:
      eventType === "message.received"
        ? inboundApplicationKey(inboxRef, messageRef)
        : outboundApplicationKey(messageRef, eventType),
    providerMessageRef: messageRef,
    ...(args.threadRef !== undefined
      ? { providerThreadRef: args.threadRef }
      : {}),
    eventType,
    reason: "event_unparseable",
    ...(args.providerTimestamp !== undefined
      ? { providerTimestamp: args.providerTimestamp }
      : {}),
    note: args.note,
  });
}

/**
 * Resolve the owning org from the saved inbox assignment alone
 * (architecture §8 step 2: never guess an org from a body or a display
 * address). `.collect()` rather than `.unique()`: the assignment's uniqueness
 * is transactional, not a database constraint, and `.unique()` would throw on
 * a violated invariant — on the one code path that cannot survive a throw.
 *
 * Zero rows is an unknown inbox; more than one is an ambiguity no callback may
 * resolve by guessing. Both return the reason rather than a bare `null`, so
 * the caller can QUARANTINE the event instead of dropping it: the component
 * has already marked the `event_id` ingested, so a provider retry returns
 * before enqueueing anything, and an unrecorded event is lost for good.
 * Logged with provider IDs only.
 */
async function resolveOrgByInbox(
  ctx: MutationCtx,
  inboxRef: string,
  context: string,
): Promise<
  | { org: Doc<"orgs"> }
  | { org: null; reason: QuarantineReason }
> {
  let rows = await ctx.db
    .query("orgs")
    .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
    .collect();
  const normalized = inboxRef.trim().toLowerCase();
  if (rows.length === 0 && normalized !== inboxRef) {
    // Inbox references are ADDRESSES, and the provider may echo a different
    // case than the connection stored (`sameInboxRef`, and the route's own
    // binding). An index lookup is exact, so the normalized form is tried
    // before the event is called unassigned — otherwise a difference in case
    // quarantines a perfectly ordinary message under a reference no
    // assignment matches, and nothing can ever replay it.
    rows = await ctx.db
      .query("orgs")
      .withIndex("by_inboxRef", (q) => q.eq("inboxRef", normalized))
      .collect();
  }
  if (rows.length === 0) {
    console.info(`${context}: event for unassigned inbox`, { inboxRef });
    return { org: null, reason: "inbox_unassigned" };
  }
  if (rows.length > 1) {
    console.info(`${context}: inbox claimed by multiple organizations`, {
      inboxRef,
      claims: rows.length,
    });
    return { org: null, reason: "inbox_ambiguous" };
  }
  return { org: rows[0] };
}

/**
 * Component callback: invoked once per verified webhook event whose
 * `event_id` the component has not already ingested (dispatch happens through
 * its callback pool, after the event row commits — pool retries are safe
 * because mutations are atomic).
 *
 * `event` is validated as `v.any()` deliberately: the provider may add event
 * types beyond the installed component's union, and this receiver must stay
 * up and observable rather than wedge on a validator.
 *
 * P10 wiring (P05's receipt contract landed): each verified event is recorded
 * in `emailEventReceipts` — deduped by `event_id` AND by
 * (orgId, applicationKey) — then folded onto the app-owned send
 * attempt by provider `message_id`. The app-owned sender creates no
 * component `outboundMessages` row, so the component's internal status
 * projection never matches ours — delivery facts arrive only here, and a
 * receipt that beats the send acknowledgement stays `pending` until
 * `recordSendOutcome` folds it. Verified bounce/complaint facts suppress the
 * exact email via `applyReceiptToAttempt`.
 *
 * An event whose inbox no org claims — or which two claim — has no
 * org to file a receipt under, so it is held in
 * `quarantinedEmailEvents` and replayed by `internal.inbox.quarantine.replayForInbox`
 * once the assignment exists (§G3 "Unknown inboxes are quarantined").
 */
export const onEvent = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = asRecord(args.event);
    const rawIds = extractEventIds(args.event);
    const eventId = providerRef(stringField(event, "event_id"), 200);
    const eventType = providerRef(stringField(event, "event_type"), 100);
    const inboxRef = providerRef(rawIds.inboxId);
    const messageRef = providerRef(rawIds.messageId);
    const threadRef = providerRef(rawIds.threadId);
    // Provider IDs only — never log addresses or bodies.
    console.info("agentmail.onEvent", { eventId, eventType, ...rawIds });

    // `message.received` is delivered through onMessageReceived — the
    // component fires BOTH callbacks for it; never record twice.
    if (eventType === "message.received") {
      return null;
    }
    // THE TIMESTAMP IS IN THE SUB-OBJECT, NOT THE ENVELOPE. `plan/spikes.md`
    // records the delivery envelope as `{ type, event_type, event_id }` plus
    // ONE payload key per event type (`send` / `delivery` / `bounce` /
    // `complaint` / `reject`), and the provider's own `timestamp` lives inside
    // that payload. Read from the envelope it was always `undefined`, so
    // `applyReceiptToAttempt`'s "delivery facts advance only forward" guard
    // was ordering by local arrival — which is exactly the order a re-delivery
    // scrambles.
    const payloadTimestamp = eventPayloadTimestamp(event);
    if (
      eventId === undefined ||
      eventType === undefined ||
      inboxRef === undefined ||
      messageRef === undefined
    ) {
      // Verified, and missing the identifiers a receipt is keyed on. Returning
      // here lost it permanently — the component has already marked
      // `event_id` ingested, so the provider never resends — so it is
      // quarantined instead, under keys minted from whatever the envelope did
      // carry (a digest of it, when it carried nothing usable). The row is
      // evidence, not a replayable event: `quarantine.replayOne` recognises
      // `event_unparseable` and never replays it.
      //
      // `providerEventId` is the dedupe key, so a minted one has to be unique
      // PER EVENT. Seeded from the message or the inbox — values every event
      // for that mailbox shares — distinct events would collide on one row
      // and `recordQuarantinedEvent` would drop every one after the first, so
      // an inbox missing its event ids would leave exactly one row, forever.
      // A digest of the envelope is the only seed that identifies THIS
      // delivery, and it still dedupes a provider resend of it onto the same
      // row — the same key the route-side twin mints (`inboundRoute.ts`).
      await quarantineUnparseableEvent(ctx, {
        event: args.event,
        eventId,
        inboxRef,
        messageRef,
        ...(threadRef !== undefined ? { threadRef } : {}),
        eventType,
        ...(payloadTimestamp !== undefined
          ? { providerTimestamp: payloadTimestamp }
          : {}),
        note: "verified event carried no usable inbox, message or event id",
      });
      return null;
    }
    // One business effect per (message, event type): provider re-delivery
    // under a NEW event_id must not re-apply the same fact.
    const applicationKey = outboundApplicationKey(messageRef, eventType);
    if (applicationKey.length > APPLICATION_KEY_MAX_LENGTH) {
      console.info("agentmail.onEvent: application key exceeds its bound", {
        eventId,
        eventType,
      });
      return null;
    }
    const resolved = await resolveOrgByInbox(
      ctx,
      inboxRef,
      "agentmail.onEvent",
    );
    if (resolved.org === null) {
      // Held, not dropped. `emailEventReceipts.orgId` is required and
      // there is no org to put on one, so the event goes to the
      // quarantine table until an assignment exists to replay it into.
      await recordQuarantinedEvent(ctx, {
        inboxRef,
        providerEventId: eventId,
        applicationKey,
        providerMessageRef: messageRef,
        ...(threadRef !== undefined ? { providerThreadRef: threadRef } : {}),
        eventType,
        reason: resolved.reason,
        ...(payloadTimestamp !== undefined
          ? { providerTimestamp: payloadTimestamp }
          : {}),
      });
      return null;
    }
    const org = resolved.org;
    await recordReceipt(ctx, {
      orgId: org._id,
      inboxRef,
      providerEventId: eventId,
      applicationKey,
      providerMessageRef: messageRef,
      eventType,
      ...(threadRef !== undefined ? { providerThreadRef: threadRef } : {}),
      providerFacts: {
        ...(payloadTimestamp !== undefined
          ? { timestamp: payloadTimestamp }
          : {}),
      },
    });
    return null;
  },
});

/**
 * Component callback for `message.received` events only. The component has
 * already persisted the inbound message and deduped by `event_id` before
 * this runs.
 *
 * The inbound message is recorded in `emailEventReceipts` (pending) with
 * application-key dedupe `incoming:<inbox>:<message>` — a provider
 * re-delivery under a NEW event_id lands as a handled duplicate and can never
 * start a second response workflow — and P11's `internal.inbox
 * .applyInboundMessage` is then scheduled to do the business handling.
 *
 * This function deliberately does the smallest possible amount of work: it
 * projects the payload, resolves the org from the saved inbox
 * assignment, writes the receipt and schedules. Conversation matching,
 * `contextVersion` advancement, approval invalidation and everything
 * downstream live in `convex/inbox/`, where a throw costs a retry instead of
 * the event.
 */
export const onMessageReceived = internalMutation({
  // `thread` is optional in the component's own `vEvent`
  // (`@agentmail/convex` shared.d.ts: `thread: VAny<any, "optional", string>`),
  // and `v.any()` accepts any value but NOT a missing field. Requiring it here
  // put a `message.received` that carries no thread object inside the
  // provider's contract and outside ours: the callback threw
  // ArgumentValidationError, the Workpool does not retry mutations, and the
  // component's `by_eventId` ledger refuses the provider's resend — so the
  // message was lost with no receipt to drain and no quarantine row to replay.
  // Nothing here reads it; `threadRef` comes off `message.thread_id` below.
  args: { message: v.any(), thread: v.optional(v.any()), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordInboundMessage(ctx, {
      message: args.message,
      eventId: args.eventId,
    });
    return null;
  },
});

/**
 * Record ONE verified inbound message and start its handling — the body both
 * inbound paths share.
 *
 * The component's `message.received` callback is one caller. The other is
 * `inbox/inboundRoute.ts`, which takes the provider's `message.received.spam`
 * / `.blocked` / `.unauthenticated` variants on the app's own verified route:
 * the installed component's `events.eventType` validator rejects those three,
 * so handing them to it would 500 the webhook and make the provider retry
 * forever (spikes §4). Routing them here instead is what lets them be
 * subscribed to at all — and `deliveryClass` is what keeps them readable
 * without being answerable.
 *
 * Obeys the same rule as the callback it was extracted from: it never throws.
 */
export async function recordInboundMessage(
  ctx: MutationCtx,
  args: {
    /** The provider's own `Message` object, unvalidated. */
    message: unknown;
    eventId: string;
    /**
     * How the provider flagged this delivery, for the variants that carry one.
     * Absent for an ordinary `message.received`.
     */
    deliveryClass?: "spam" | "blocked" | "unauthenticated";
  },
): Promise<void> {
  {
    const message = asRecord(args.message);
    const eventId = providerRef(args.eventId, 200);
    const inboxRef = providerRef(stringField(message, "inbox_id"));
    const threadRef = providerRef(stringField(message, "thread_id"));
    const messageRef = providerRef(stringField(message, "message_id"));
    // Provider IDs only — never log addresses or bodies.
    console.info("agentmail.recordInboundMessage", {
      eventId: args.eventId,
      inboxRef,
      threadRef,
      messageRef,
      deliveryClass: args.deliveryClass,
    });
    if (
      eventId === undefined ||
      inboxRef === undefined ||
      messageRef === undefined
    ) {
      // HELD, NOT DROPPED — and this is the one event type that carries a
      // customer's mail. Returning here lost it for good: the component has
      // already committed its `events` row and marked the `event_id`
      // ingested, so the provider never resends, the Workpool does not retry
      // mutations, and there is no receipt for the drain to find. A row keyed
      // on identifiers minted from the envelope itself is at least evidence
      // that a verified message arrived, which is what `onEvent` already does
      // for every other event type.
      await quarantineUnparseableEvent(ctx, {
        event: args.message,
        eventId,
        inboxRef,
        messageRef,
        ...(threadRef !== undefined ? { threadRef } : {}),
        eventType: "message.received",
        note: "verified inbound message carried no usable inbox, message or event id",
      });
      return;
    }
    const applicationKey = inboundApplicationKey(inboxRef, messageRef);
    if (applicationKey.length > APPLICATION_KEY_MAX_LENGTH) {
      console.info(
        "agentmail.onMessageReceived: application key exceeds its bound",
        { eventId },
      );
      return;
    }
    const resolved = await resolveOrgByInbox(
      ctx,
      inboxRef,
      "agentmail.onMessageReceived",
    );
    if (resolved.org === null) {
      // Held, not dropped — the customer's reply is the thing this whole path
      // exists for. Provider identifiers only: the message itself is already
      // in the component's own `inboundMessages` row, which is what makes the
      // replay possible without a second copy of it. The sender and the
      // opt-out verdict are deliberately NOT projected here; they are
      // recomputed at replay from that row by the same two functions used
      // below, so a held message is judged by the rules in force when it is
      // finally processed.
      await recordQuarantinedEvent(ctx, {
        inboxRef,
        providerEventId: eventId,
        applicationKey,
        providerMessageRef: messageRef,
        ...(threadRef !== undefined ? { providerThreadRef: threadRef } : {}),
        eventType: "message.received",
        reason: resolved.reason,
      });
      return;
    }
    const org = resolved.org;
    // The only projection of the payload that survives this function. The
    // sender is stored as DATA — it never selects an org or conversation
    // and never becomes a send recipient — and it rides on the receipt rather
    // than in the scheduler argument so the drain can re-drive from the row
    // alone. No subject, no body, no headers: §4.3 keeps receipts to the
    // verified facts a business decision needs.
    const fromAddress = parseInboundSender(message?.from);
    // The deterministic opt-out rule runs HERE, while the raw payload is in
    // memory — it is the only place the unprojected body exists without a
    // provider round trip. Only the enum and the name of the rule that fired
    // travel onward; the body itself never reaches an app table, a scheduler
    // argument or a log line.
    const optOut = evaluateOptOutText({
      subject: message?.subject,
      text: message?.text,
      extractedText: message?.extracted_text,
    });
    // THE single writer (PLAN §9.4). It looks the message up on
    // `(orgId, inboxRef, providerMessageRef)` first, so a backfilled row
    // for this very message is MERGED and promoted to `live` instead of
    // becoming a second row — and so this callback can never insert one
    // directly.
    const { receipt, startsHandling } = await upsertMessage(ctx, {
      orgId: org._id,
      inboxRef,
      providerMessageRef: messageRef,
      ...(threadRef !== undefined ? { providerThreadRef: threadRef } : {}),
      providerEventId: eventId,
      source: "live" as const,
      providerFacts: {
        ...(fromAddress !== undefined ? { fromAddress } : {}),
        optOutSignal: optOut.signal,
        ...(optOut.rule !== undefined ? { optOutRule: optOut.rule } : {}),
        // Recorded as a FACT, not a filter: a flagged or unauthenticated
        // delivery is stored and readable exactly like any other, and the
        // history gate is what refuses to let automation answer it.
        ...(args.deliveryClass !== undefined
          ? { deliveryClass: args.deliveryClass }
          : {}),
      },
    });
    // `startsHandling` is false for every duplicate — the same provider event
    // id, the same MESSAGE under a second event id, and the promotion of a
    // backfilled row. The business path has already run at most once and must
    // not run again: this is the application-effect dedupe, and it sits above
    // every write P11 makes to a conversation.
    if (!startsHandling) {
      return;
    }
    // Scheduled, not inlined. The schedule commits with the receipt insert, so
    // a throw in the business path cannot roll back the row that makes the
    // event replayable, and the `pending` row is the drain's input.
    await ctx.scheduler.runAfter(0, internal.inbox.inbound.applyInboundMessage, {
      receiptId: receipt._id,
    });
  }
}
