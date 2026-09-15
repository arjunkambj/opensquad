/**
 * OpenSquad ↔ AgentMail boundary (P05 — transport-only spike).
 *
 * Two narrow responsibilities (plan/integrations.md §G3):
 *
 * 1. INBOUND — the registered `@agentmail/convex` component owns verified,
 *    `event_id`-deduplicated webhook ingestion and inbound message storage.
 *    `agentmail` below is its configured client handle; `convex/http.ts`
 *    mounts `handleWebhook` at POST /agentmail/webhook. `onEvent` and
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
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { recordQuarantinedEvent } from "../quarantine";
import { recordReceipt } from "../sendAttempts";
import {
  evaluateOptOutText,
  inboundApplicationKey,
  outboundApplicationKey,
  parseInboundSender,
  PROVIDER_REF_MAX_LENGTH,
} from "../lib/validators";
import type { QuarantineReason } from "../lib/validators";

/**
 * Shared component client handle. Credentials are read from deployment env
 * vars inside the component's own functions — `AGENTMAIL_API_KEY`,
 * `AGENTMAIL_WEBHOOK_SECRET`, optional `AGENTMAIL_BASE_URL` — and are never
 * passed as function args, so they cannot appear in Convex logs.
 * `retryAttempts`/`initialBackoffMs` stay at component defaults; they tune
 * only the component's own sender, which OpenSquad does not use.
 */
export const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.integrations.agentmail.onMessageReceived,
  onEvent: internal.integrations.agentmail.onEvent,
});

// ---------------------------------------------------------------------------
// Outbound: the narrow send adapter
// ---------------------------------------------------------------------------

const AGENTMAIL_DEFAULT_BASE_URL = "https://api.agentmail.to/v0";
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
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    // Misconfiguration, not a provider verdict: no request was ever made.
    // Throw so operators see a loud configuration error rather than a
    // recorded provider outcome.
    throw new Error(
      "AGENTMAIL_API_KEY is not set on this Convex deployment.",
    );
  }
  const baseUrl = (
    process.env.AGENTMAIL_BASE_URL ?? AGENTMAIL_DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
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
    return {
      outcome: "uncertain",
      reason: isTimeout ? "timeout" : "transport_error",
      httpStatus: response?.status,
      detail:
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
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
    return {
      outcome: "uncertain",
      reason: "idempotency_conflict",
      httpStatus: response.status,
      detail: truncateResponseBody(responseText),
    };
  }

  if (response.status >= 500) {
    // A 5xx is not a definitive refusal — the provider may have accepted the
    // message before failing. Per architecture §8.8 this is never a
    // "definitively safe retry"; it is uncertain.
    return {
      outcome: "uncertain",
      reason: "http_5xx",
      httpStatus: response.status,
      detail: truncateResponseBody(responseText),
    };
  }

  if (!response.ok) {
    // Remaining 4xx: the provider definitively refused this request.
    return {
      outcome: "rejected",
      httpStatus: response.status,
      providerError: truncateResponseBody(responseText),
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
      detail: "2xx response body was not valid JSON",
    };
  }
  if (!isSendAcceptedBody(body)) {
    return {
      outcome: "uncertain",
      reason: "malformed_response",
      httpStatus: response.status,
      detail: "2xx response lacked a non-empty message_id/thread_id",
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

function truncateResponseBody(text: string): string {
  return text.length > PROVIDER_ERROR_BODY_LIMIT
    ? `${text.slice(0, PROVIDER_ERROR_BODY_LIMIT)}…[truncated]`
    : text;
}

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
 * draft revision, workspace/campaign status, suppression, allowed demo
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
    inboxId: v.string(),
    idempotencyKey: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (_ctx, args) =>
    performSingleSendRequest({ ...args, endpointOperation: "send" }),
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
 * - workspace policy still permits dispatch (not paused, taken over or
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
    inboxId: v.string(),
    idempotencyKey: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (_ctx, args) =>
    performSingleSendRequest({ ...args, endpointOperation: "send" }),
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
    inboxId: v.string(),
    idempotencyKey: v.string(),
    parentMessageId: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (_ctx, args) =>
    performSingleSendRequest({ ...args, endpointOperation: "reply" }),
});

/** P10: reconciliation replay for an `uncertain` reply attempt — same
 *  key, same payload, same parent, audit-distinct name. */
export const reconcileReplyAttempt = internalAction({
  args: {
    inboxId: v.string(),
    idempotencyKey: v.string(),
    parentMessageId: v.string(),
    payload: vSendRequestBody,
  },
  returns: vSendAttemptResult,
  handler: async (_ctx, args) =>
    performSingleSendRequest({ ...args, endpointOperation: "reply" }),
});

/**
 * P10: read-only provider evidence lookup for uncertain-attempt
 * reconciliation (G3 step 8 — "use provider read APIs and webhook
 * evidence"). Calls the component's own `getMessage`/`getThread` reads —
 * never mutates provider state. Returns a bounded, sanitized projection:
 * provider IDs and existence only, no addresses or bodies.
 */
export const lookupProviderMessage = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
  },
  returns: v.object({
    message: v.union(
      v.object({
        messageId: v.string(),
        threadId: v.string(),
      }),
      v.null(),
    ),
    thread: v.union(
      v.object({
        threadId: v.string(),
        messageCount: v.optional(v.number()),
      }),
      v.null(),
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const result: {
      message: { messageId: string; threadId: string } | null;
      thread: { threadId: string; messageCount?: number } | null;
      error?: string;
    } = { message: null, thread: null };
    if (args.messageId !== undefined) {
      try {
        const message = (await agentmail.getMessage(
          ctx,
          args.inboxId,
          args.messageId,
        )) as Record<string, unknown> | null;
        if (message !== null && typeof message.message_id === "string") {
          result.message = {
            messageId: message.message_id,
            threadId:
              typeof message.thread_id === "string" ? message.thread_id : "",
          };
        }
      } catch (error) {
        // A 404 means the provider holds no such message — meaningful
        // evidence, not a crash.
        result.error =
          error instanceof Error ? `getMessage: ${error.message}` : "getMessage failed";
      }
    }
    if (args.threadId !== undefined) {
      try {
        const thread = (await agentmail.getThread(
          ctx,
          args.inboxId,
          args.threadId,
        )) as Record<string, unknown> | null;
        if (thread !== null && typeof thread.thread_id === "string") {
          const messages = thread.messages;
          result.thread = {
            threadId: thread.thread_id,
            messageCount: Array.isArray(messages) ? messages.length : undefined,
          };
        }
      } catch (error) {
        result.error =
          error instanceof Error ? `getThread: ${error.message}` : "getThread failed";
      }
    }
    return result;
  },
});

/**
 * DEV-ONLY diagnostic reader for the live P05 probe. Projects the
 * component's inbound-message mirror and inbox cache down to provider IDs so
 * the probe can verify webhook ingest/dedupe without exposing addresses or
 * bodies to logs. Internal-only — unreachable from clients or HTTP routes.
 * **TODO(P16): remove before public release** (same rule as the former
 * diagnosticSendProbe; this is a read-only helper, not a send path).
 */
export const diagnosticInboundState = internalAction({
  args: { inboxId: v.optional(v.string()) },
  returns: v.object({
    inboundMessages: v.array(
      v.object({
        inboxId: v.string(),
        threadId: v.string(),
        messageId: v.string(),
        eventId: v.string(),
        timestamp: v.optional(v.number()),
      }),
    ),
    cachedInboxes: v.array(v.object({ inboxId: v.string() })),
  }),
  handler: async (ctx, args) => {
    const rows = (await ctx.runQuery(
      components.agentmail.lib.listInboundMessages,
      args.inboxId ? { inboxId: args.inboxId } : {},
    )) as Array<Record<string, unknown>>;
    const inboxes = (await ctx.runQuery(
      components.agentmail.lib.listCachedInboxes,
      {},
    )) as Array<Record<string, unknown>>;
    return {
      inboundMessages: rows.map((row) => ({
        inboxId: String(row.inboxId),
        threadId: String(row.threadId),
        messageId: String(row.messageId),
        eventId: String(row.eventId),
        timestamp:
          typeof row.timestamp === "number" ? row.timestamp : undefined,
      })),
      cachedInboxes: inboxes.map((inbox) => ({
        inboxId: String(inbox.inboxId),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Inbound: component webhook callbacks (P05 stubs — P11 owns full handling)
// ---------------------------------------------------------------------------

/**
 * Pull inbox/thread/message identifiers out of any AgentMail event payload,
 * whichever sub-object carries them (message/send/delivery/bounce/complaint/
 * reject). Mirrors the component's eventLogic.extractIndexFields, which is
 * not part of the package's public exports.
 */
function extractEventIndexFields(event: unknown): {
  inboxId?: string;
  threadId?: string;
  messageId?: string;
} {
  const record = asRecord(event);
  const payload =
    asRecord(record?.message) ??
    asRecord(record?.send) ??
    asRecord(record?.delivery) ??
    asRecord(record?.bounce) ??
    asRecord(record?.complaint) ??
    asRecord(record?.reject) ??
    null;
  return {
    inboxId: stringField(payload, "inbox_id"),
    threadId: stringField(payload, "thread_id"),
    messageId: stringField(payload, "message_id"),
  };
}

/* ------------------------------------------------------------------ */
/* Callback totality helpers                                           */
/* ------------------------------------------------------------------ */

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
 * Resolve the owning workspace from the saved inbox assignment alone
 * (architecture §8 step 2: never guess a workspace from a body or a display
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
async function resolveWorkspaceByInbox(
  ctx: MutationCtx,
  inboxRef: string,
  context: string,
): Promise<
  | { workspace: Doc<"workspaces"> }
  | { workspace: null; reason: QuarantineReason }
> {
  const rows = await ctx.db
    .query("workspaces")
    .withIndex("by_inboxRef", (q) => q.eq("inboxRef", inboxRef))
    .collect();
  if (rows.length === 0) {
    console.info(`${context}: event for unassigned inbox`, { inboxRef });
    return { workspace: null, reason: "inbox_unassigned" };
  }
  if (rows.length > 1) {
    console.info(`${context}: inbox claimed by multiple workspaces`, {
      inboxRef,
      claims: rows.length,
    });
    return { workspace: null, reason: "inbox_ambiguous" };
  }
  return { workspace: rows[0] };
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
 * (workspaceId, applicationKey) — then folded onto the app-owned send
 * attempt by provider `message_id`. The app-owned sender creates no
 * component `outboundMessages` row, so the component's internal status
 * projection never matches ours — delivery facts arrive only here, and a
 * receipt that beats the send acknowledgement stays `pending` until
 * `recordSendOutcome` folds it. Verified bounce/complaint facts suppress the
 * exact email via `applyReceiptToAttempt`.
 *
 * An event whose inbox no workspace claims — or which two claim — has no
 * workspace to file a receipt under, so it is held in
 * `quarantinedEmailEvents` and replayed by `internal.quarantine.replayForInbox`
 * once the assignment exists (§G3 "Unknown inboxes are quarantined").
 */
export const onEvent = internalMutation({
  args: { event: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = asRecord(args.event);
    const rawIds = extractEventIndexFields(args.event);
    const eventId = providerRef(stringField(event, "event_id"), 200);
    const eventType = providerRef(stringField(event, "event_type"), 100);
    const inboxRef = providerRef(rawIds.inboxId);
    const messageRef = providerRef(rawIds.messageId);
    const threadRef = providerRef(rawIds.threadId);
    // Provider IDs only — never log addresses or bodies.
    console.info("agentmail.onEvent", { eventId, eventType, ...rawIds });

    // `message.received` is delivered through onMessageReceived — the
    // component fires BOTH callbacks for it; never record twice.
    if (
      eventType === "message.received" ||
      eventId === undefined ||
      eventType === undefined ||
      inboxRef === undefined ||
      messageRef === undefined
    ) {
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
    const payloadTimestamp = numberField(event, "timestamp");
    const resolved = await resolveWorkspaceByInbox(
      ctx,
      inboxRef,
      "agentmail.onEvent",
    );
    if (resolved.workspace === null) {
      // Held, not dropped. `emailEventReceipts.workspaceId` is required and
      // there is no workspace to put on one, so the event goes to the
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
    const workspace = resolved.workspace;
    await recordReceipt(ctx, {
      workspaceId: workspace._id,
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
 * projects the payload, resolves the workspace from the saved inbox
 * assignment, writes the receipt and schedules. Conversation matching,
 * `contextVersion` advancement, approval invalidation and everything
 * downstream live in `convex/inbox.ts`, where a throw costs a retry instead of
 * the event.
 */
export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = asRecord(args.message);
    const eventId = providerRef(args.eventId, 200);
    const inboxRef = providerRef(stringField(message, "inbox_id"));
    const threadRef = providerRef(stringField(message, "thread_id"));
    const messageRef = providerRef(stringField(message, "message_id"));
    // Provider IDs only — never log addresses or bodies.
    console.info("agentmail.onMessageReceived", {
      eventId: args.eventId,
      inboxRef,
      threadRef,
      messageRef,
    });
    if (
      eventId === undefined ||
      inboxRef === undefined ||
      messageRef === undefined
    ) {
      return null;
    }
    const applicationKey = inboundApplicationKey(inboxRef, messageRef);
    if (applicationKey.length > APPLICATION_KEY_MAX_LENGTH) {
      console.info(
        "agentmail.onMessageReceived: application key exceeds its bound",
        { eventId },
      );
      return null;
    }
    const resolved = await resolveWorkspaceByInbox(
      ctx,
      inboxRef,
      "agentmail.onMessageReceived",
    );
    if (resolved.workspace === null) {
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
      return null;
    }
    const workspace = resolved.workspace;
    // The only projection of the payload that survives this function. The
    // sender is stored as DATA — it never selects a workspace or conversation
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
    const { receipt, duplicate, duplicateApplicationKey } = await recordReceipt(
      ctx,
      {
        workspaceId: workspace._id,
        inboxRef,
        providerEventId: eventId,
        applicationKey,
        providerMessageRef: messageRef,
        eventType: "message.received",
        ...(threadRef !== undefined ? { providerThreadRef: threadRef } : {}),
        providerFacts: {
          ...(fromAddress !== undefined ? { fromAddress } : {}),
          optOutSignal: optOut.signal,
          ...(optOut.rule !== undefined ? { optOutRule: optOut.rule } : {}),
        },
      },
    );
    // `duplicate` — the same provider event id, already recorded; nothing was
    // written. `duplicateApplicationKey` — the same MESSAGE under a second
    // event id, recorded as `handled` so it stays auditable. Either way the
    // business path has already run at most once and must not run again: this
    // is the application-effect dedupe, and it sits above every write P11
    // makes to a conversation.
    if (duplicate || duplicateApplicationKey) {
      return null;
    }
    // Scheduled, not inlined. The schedule commits with the receipt insert, so
    // a throw in the business path cannot roll back the row that makes the
    // event replayable, and the `pending` row is the drain's input.
    await ctx.scheduler.runAfter(0, internal.inbox.applyInboundMessage, {
      receiptId: receipt._id,
    });
    return null;
  },
});
