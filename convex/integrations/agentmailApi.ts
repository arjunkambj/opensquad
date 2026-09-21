/**
 * The per-org AgentMail REST surface (PLAN §4 "Manage inbox", §9.4).
 *
 * WHY NOT THE COMPONENT. `@agentmail/convex@0.1.0` reads `AGENTMAIL_API_KEY`
 * from `process.env` inside its own functions (dist/component/utils.js), so it
 * has no seam for a per-org key. Every call keyed to an org —
 * verify, list/create inbox, register/list/delete webhook, list threads, read
 * a thread — therefore goes through this file, which takes the DECRYPTED key
 * as an argument. The component is kept for exactly one job: verifying,
 * deduping and storing an inbound webhook, through a per-request
 * `new AgentMail(components.agentmail, { webhookSecret })`.
 *
 * WHAT NEVER LEAVES. Provider wording stays here (PLAN §4 white-label rule):
 * every failure is returned as one of `AgentMailErrorCode` plus the HTTP
 * status, and the response body is only ever written to a server log, bounded.
 * The API key is never logged and never appears in a return value.
 *
 * Shapes follow the provider's OpenAPI document as recorded in
 * `plan/spikes.md` §4; fields are read defensively because the document is the
 * contract and the response is data.
 */
import { boundedString } from "../lib/validators";
import { env } from "../_generated/server";

const AGENTMAIL_DEFAULT_BASE_URL = "https://api.agentmail.to/v0";

/** One provider request's deadline. Connect/backfill steps stay short. */
const REQUEST_TIMEOUT_MS = 20_000;

/** How much of a failing response body reaches the server log. */
const ERROR_BODY_LOG_LIMIT = 512;

/** Threads per backfill listing page — one scheduled step's worth. */
export const THREAD_PAGE_LIMIT = 25;

/** Messages read per thread page; the provider caps this at 100. */
export const THREAD_MESSAGE_PAGE_LIMIT = 100;

/**
 * The event types the installed component may be handed — EXACTLY the seven
 * its `vEventType` union accepts.
 *
 * Handing it anything else is a live hazard, not a feature flag (spikes §4):
 * the component's `events.eventType` column is typed with that union and
 * Convex validates inserts, so a `message.opened` or any `message.received.*`
 * variant makes `handleEvent` throw, the HTTP action 500s, and the provider
 * retries the event forever. Open tracking is out of this build for that
 * reason.
 */
export const AGENTMAIL_COMPONENT_EVENT_TYPES = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.bounced",
  "message.complained",
  "message.rejected",
  "domain.verified",
] as const;

/**
 * The three inbound variants the provider sends under their OWN event type
 * rather than as `message.received` (spikes §4, `EventType`).
 *
 * They matter because legitimate senders routinely omit authentication
 * headers, and the provider's thread listing excludes all three by default —
 * so a real reply can be flagged and then never seen at all. They are
 * subscribed to, and `inbox/inboundRoute.ts` takes them on the app's OWN
 * verified route instead of passing them to the component, which would 500 on
 * them. What they may then DO is deliberately narrow: they are recorded and
 * readable in the Inbox, and `evaluateReplyHistory` refuses to let automation
 * answer them (`delivery_unverified`) — a flagged or unauthenticated message
 * is exactly the one a spoofed `From` would arrive on, so a person decides.
 */
export const AGENTMAIL_ROUTED_RECEIVED_EVENT_TYPES = [
  "message.received.spam",
  "message.received.blocked",
  "message.received.unauthenticated",
] as const;

/** Everything a connect or rotate registers the webhook for. */
export const AGENTMAIL_WEBHOOK_EVENT_TYPES = [
  ...AGENTMAIL_COMPONENT_EVENT_TYPES,
  ...AGENTMAIL_ROUTED_RECEIVED_EVENT_TYPES,
] as const;

export type AgentMailRoutedReceivedEventType =
  (typeof AGENTMAIL_ROUTED_RECEIVED_EVENT_TYPES)[number];

/**
 * Is this an inbound event the component cannot store, which the route must
 * therefore ingest itself?
 */
export function routedReceivedEventType(
  eventType: string,
): AgentMailRoutedReceivedEventType | undefined {
  return AGENTMAIL_ROUTED_RECEIVED_EVENT_TYPES.find(
    (candidate) => candidate === eventType,
  );
}

/**
 * How a routed inbound message was flagged, as one short word stored on the
 * receipt. Derived from the event type, never from the payload.
 */
export function deliveryClassOf(
  eventType: AgentMailRoutedReceivedEventType,
): "spam" | "blocked" | "unauthenticated" {
  switch (eventType) {
    case "message.received.spam":
      return "spam";
    case "message.received.blocked":
      return "blocked";
    case "message.received.unauthenticated":
      return "unauthenticated";
  }
}

/**
 * Mapped failure vocabulary. `unauthorized` is the one the connection state
 * machine acts on: it flips the stored key to `invalid` and pauses the agent.
 */
export type AgentMailErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "transport_error"
  | "invalid_response";

export type AgentMailResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AgentMailErrorCode; httpStatus?: number };

export function agentmailBaseUrl(): string {
  return (env.AGENTMAIL_BASE_URL ?? AGENTMAIL_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

/**
 * A deterministic `client_id` for a create call, so re-connecting returns the
 * resource that already exists instead of making a second one (PLAN §9.4
 * "webhook `client_id` = org id so re-connect is idempotent"). The
 * provider forbids `@` in a client id; a Convex document id contains none,
 * and the prefix keeps inbox and webhook ids from colliding.
 */
export function agentmailClientId(kind: "inbox" | "webhook", orgId: string): string {
  return `${kind}-${orgId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringList(
  record: Record<string, unknown> | null,
  key: string,
): string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Provider timestamps arrive as ISO strings or epoch numbers. */
function readTimestamp(
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

function statusToCode(status: number): AgentMailErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "invalid_request";
}

/**
 * ONE provider request. No retry: every caller here is a short scheduled step
 * whose own re-drive is the retry, and a silent retry inside a create would
 * defeat the `client_id` idempotency the plan relies on.
 */
async function agentmailRequest(args: {
  apiKey: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Array<[string, string]>;
  body?: Record<string, unknown>;
  /** DELETE /v0/webhooks/{id} answers 200 with NO body (spikes §4). */
  expectEmptyBody?: boolean;
}): Promise<AgentMailResult<unknown>> {
  const search = new URLSearchParams();
  for (const [key, value] of args.query ?? []) {
    search.append(key, value);
  }
  const suffix = search.toString();
  const url = `${agentmailBaseUrl()}${args.path}${suffix.length > 0 ? `?${suffix}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        ...(args.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(args.body !== undefined
        ? { body: JSON.stringify(args.body) }
        : {}),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    const aborted = controller.signal.aborted;
    console.info("agentmail.request failed", {
      path: args.path,
      method: args.method,
      reason: aborted ? "timeout" : "transport_error",
      detail: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, code: aborted ? "timeout" : "transport_error" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Provider wording is logged, never returned (white-label rule).
    console.info("agentmail.request rejected", {
      path: args.path,
      method: args.method,
      status: response.status,
      body: text.slice(0, ERROR_BODY_LOG_LIMIT),
    });
    return {
      ok: false,
      code: statusToCode(response.status),
      httpStatus: response.status,
    };
  }
  if (args.expectEmptyBody === true || text.trim().length === 0) {
    return { ok: true, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    console.info("agentmail.request returned unreadable JSON", {
      path: args.path,
      method: args.method,
      status: response.status,
    });
    return {
      ok: false,
      code: "invalid_response",
      httpStatus: response.status,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Inboxes                                                             */
/* ------------------------------------------------------------------ */

export type AgentMailInbox = {
  inboxId: string;
  /** The mailbox address. AgentMail inbox ids ARE addresses; `email` is the
   *  field the document declares, and this falls back to the id. */
  address: string;
  displayName?: string;
};

export type AgentMailInboxPage = {
  inboxes: AgentMailInbox[];
  nextPageToken?: string;
};

function parseInbox(value: unknown): AgentMailInbox | null {
  const record = asRecord(value);
  const inboxId = readString(record, "inbox_id");
  if (inboxId === undefined) {
    return null;
  }
  const displayName = readString(record, "display_name");
  return {
    inboxId,
    address: readString(record, "email") ?? inboxId,
    ...(displayName !== undefined ? { displayName } : {}),
  };
}

/**
 * `GET /v0/inboxes` — also THE key verification call (PLAN §4 step 1): a key
 * the provider refuses answers 401 before anything is stored.
 */
export async function listInboxes(
  apiKey: string,
  args: { limit?: number; pageToken?: string } = {},
): Promise<AgentMailResult<AgentMailInboxPage>> {
  const query: Array<[string, string]> = [];
  if (args.limit !== undefined) query.push(["limit", String(args.limit)]);
  if (args.pageToken !== undefined)
    query.push(["page_token", args.pageToken]);
  const result = await agentmailRequest({
    apiKey,
    method: "GET",
    path: "/inboxes",
    query,
  });
  if (!result.ok) {
    return result;
  }
  const record = asRecord(result.value);
  const rows = Array.isArray(record?.inboxes) ? record.inboxes : [];
  const nextPageToken = readString(record, "next_page_token");
  return {
    ok: true,
    value: {
      inboxes: rows
        .map(parseInbox)
        .filter((inbox): inbox is AgentMailInbox => inbox !== null),
      ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    },
  };
}

/** `POST /v0/inboxes` — `client_id` makes a repeat return the original. */
export async function createInbox(
  apiKey: string,
  args: { clientId: string; username?: string; displayName?: string },
): Promise<AgentMailResult<AgentMailInbox>> {
  const result = await agentmailRequest({
    apiKey,
    method: "POST",
    path: "/inboxes",
    body: {
      client_id: args.clientId,
      ...(args.username !== undefined ? { username: args.username } : {}),
      ...(args.displayName !== undefined
        ? { display_name: args.displayName }
        : {}),
    },
  });
  if (!result.ok) {
    return result;
  }
  const inbox = parseInbox(result.value);
  return inbox === null
    ? { ok: false, code: "invalid_response" }
    : { ok: true, value: inbox };
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

export type AgentMailWebhook = {
  webhookId: string;
  url: string;
  /** The `whsec_…` Svix signing secret. Re-readable on a later GET. */
  secret: string;
  enabled: boolean;
  inboxIds: string[];
  clientId?: string;
};

function parseWebhook(value: unknown): AgentMailWebhook | null {
  const record = asRecord(value);
  const webhookId = readString(record, "webhook_id");
  const secret = readString(record, "secret");
  if (webhookId === undefined || secret === undefined) {
    return null;
  }
  const clientId = readString(record, "client_id");
  return {
    webhookId,
    url: readString(record, "url") ?? "",
    secret,
    enabled: record?.enabled !== false,
    inboxIds: readStringList(record, "inbox_ids"),
    ...(clientId !== undefined ? { clientId } : {}),
  };
}

/**
 * `POST /v0/webhooks` on the USER's account. `client_id` is deterministic per
 * org, so connecting twice returns the webhook that already exists
 * rather than registering a second one.
 */
export async function createWebhook(
  apiKey: string,
  args: {
    url: string;
    inboxIds: string[];
    clientId: string;
  },
): Promise<AgentMailResult<AgentMailWebhook>> {
  const result = await agentmailRequest({
    apiKey,
    method: "POST",
    path: "/webhooks",
    body: {
      url: args.url,
      event_types: [...AGENTMAIL_WEBHOOK_EVENT_TYPES],
      inbox_ids: args.inboxIds,
      client_id: args.clientId,
    },
  });
  if (!result.ok) {
    return result;
  }
  const webhook = parseWebhook(result.value);
  return webhook === null
    ? { ok: false, code: "invalid_response" }
    : { ok: true, value: webhook };
}

/**
 * `DELETE /v0/webhooks/{id}` — 200 with no body. A 404 counts as success:
 * disconnect wants the webhook gone, and it already is.
 */
export async function deleteWebhook(
  apiKey: string,
  webhookId: string,
): Promise<AgentMailResult<null>> {
  const result = await agentmailRequest({
    apiKey,
    method: "DELETE",
    path: `/webhooks/${encodeURIComponent(webhookId)}`,
    expectEmptyBody: true,
  });
  if (!result.ok && result.code === "not_found") {
    return { ok: true, value: null };
  }
  return result.ok ? { ok: true, value: null } : result;
}

/* ------------------------------------------------------------------ */
/* Threads and messages — the 30-day backfill                          */
/* ------------------------------------------------------------------ */

export type AgentMailThreadRef = {
  threadId: string;
  timestamp?: number;
  subject?: string;
};

export type AgentMailMessage = {
  messageId: string;
  threadId: string;
  inboxId: string;
  timestamp?: number;
  from?: string;
  subject?: string;
  preview?: string;
  text?: string;
  extractedText?: string;
  /** Present when the sender wrote HTML — often the ONLY body they wrote. */
  html?: string;
  extractedHtml?: string;
  /**
   * RFC 5322 headers, when the provider returned them. Optional on the REST
   * Message and not something a webhook payload is guaranteed to carry, which
   * is why the bounce and auto-reply rules that read them degrade to phrase
   * matching rather than assuming they are there.
   */
  headers?: Record<string, string>;
};

function parseThreadRef(value: unknown): AgentMailThreadRef | null {
  const record = asRecord(value);
  const threadId = readString(record, "thread_id");
  if (threadId === undefined) {
    return null;
  }
  const timestamp = readTimestamp(record, "timestamp");
  const subject = readString(record, "subject");
  return {
    threadId,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(subject !== undefined ? { subject } : {}),
  };
}

function parseMessage(value: unknown): AgentMailMessage | null {
  const record = asRecord(value);
  const messageId = readString(record, "message_id");
  const threadId = readString(record, "thread_id");
  const inboxId = readString(record, "inbox_id");
  if (messageId === undefined || threadId === undefined || inboxId === undefined) {
    return null;
  }
  const timestamp = readTimestamp(record, "timestamp");
  const from = readString(record, "from");
  const subject = readString(record, "subject");
  const preview = readString(record, "preview");
  const text = readString(record, "text");
  const extractedText = readString(record, "extracted_text");
  const html = readString(record, "html");
  const extractedHtml = readString(record, "extracted_html");
  const headers = readHeaders(record);
  return {
    messageId,
    threadId,
    inboxId,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(preview !== undefined ? { preview } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(extractedText !== undefined ? { extractedText } : {}),
    ...(html !== undefined ? { html } : {}),
    ...(extractedHtml !== undefined ? { extractedHtml } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };
}

/** Header names lower-cased, values bounded; anything unexpected is dropped. */
function readHeaders(
  record: Record<string, unknown> | null,
): Record<string, string> | undefined {
  const raw = record?.headers;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      headers[name.toLowerCase()] = value.slice(0, HEADER_VALUE_MAX_LENGTH);
    }
  }
  return Object.keys(headers).length === 0 ? undefined : headers;
}

/** How much of one header value is kept — the rules read prefixes only. */
const HEADER_VALUE_MAX_LENGTH = 500;

/**
 * `GET /v0/inboxes/{id}/threads` — one page of the backfill.
 *
 * `labels` is a REPEATABLE query parameter, never a comma-joined string
 * (spikes §4); `after` bounds the import to the last 30 days.
 */
export async function listThreads(
  apiKey: string,
  inboxId: string,
  args: {
    afterMs?: number;
    limit?: number;
    pageToken?: string;
    labels?: string[];
  } = {},
): Promise<
  AgentMailResult<{ threads: AgentMailThreadRef[]; nextPageToken?: string }>
> {
  const query: Array<[string, string]> = [];
  query.push(["limit", String(args.limit ?? THREAD_PAGE_LIMIT)]);
  if (args.afterMs !== undefined) {
    query.push(["after", new Date(args.afterMs).toISOString()]);
  }
  if (args.pageToken !== undefined) {
    query.push(["page_token", args.pageToken]);
  }
  for (const label of args.labels ?? []) {
    query.push(["labels", label]);
  }
  const result = await agentmailRequest({
    apiKey,
    method: "GET",
    path: `/inboxes/${encodeURIComponent(inboxId)}/threads`,
    query,
  });
  if (!result.ok) {
    return result;
  }
  const record = asRecord(result.value);
  const rows = Array.isArray(record?.threads) ? record.threads : [];
  const nextPageToken = readString(record, "next_page_token");
  return {
    ok: true,
    value: {
      threads: rows
        .map(parseThreadRef)
        .filter((thread): thread is AgentMailThreadRef => thread !== null),
      ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    },
  };
}

/**
 * `GET /v0/inboxes/{id}/threads/{thread_id}` — the ONLY listing that carries
 * bodies. The flat `/messages` list omits `text`/`html`, so the backfill reads
 * one thread per step instead (spikes §4).
 */
export async function getThread(
  apiKey: string,
  inboxId: string,
  threadId: string,
  args: { limit?: number; pageToken?: string } = {},
): Promise<
  AgentMailResult<{ messages: AgentMailMessage[]; nextPageToken?: string }>
> {
  const query: Array<[string, string]> = [
    ["limit", String(Math.min(args.limit ?? THREAD_MESSAGE_PAGE_LIMIT, THREAD_MESSAGE_PAGE_LIMIT))],
  ];
  if (args.pageToken !== undefined) {
    query.push(["page_token", args.pageToken]);
  }
  const result = await agentmailRequest({
    apiKey,
    method: "GET",
    path: `/inboxes/${encodeURIComponent(inboxId)}/threads/${encodeURIComponent(threadId)}`,
    query,
  });
  if (!result.ok) {
    return result;
  }
  const record = asRecord(result.value);
  const rows = Array.isArray(record?.messages) ? record.messages : [];
  const nextPageToken = readString(record, "next_page_token");
  return {
    ok: true,
    value: {
      messages: rows
        .map(parseMessage)
        .filter((message): message is AgentMailMessage => message !== null),
      ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    },
  };
}

/** `GET /v0/inboxes/{id}/messages/{id}` — reconciliation evidence only. */
export async function getMessage(
  apiKey: string,
  inboxId: string,
  messageId: string,
): Promise<AgentMailResult<AgentMailMessage>> {
  const result = await agentmailRequest({
    apiKey,
    method: "GET",
    path: `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
  });
  if (!result.ok) {
    return result;
  }
  const message = parseMessage(result.value);
  return message === null
    ? { ok: false, code: "invalid_response" }
    : { ok: true, value: message };
}

/**
 * The mapped, client-safe sentence for a provider failure. Kept here so the
 * one place that knows the provider's vocabulary is the one place that
 * translates it; callers store or surface the result, never the raw body.
 */
export function agentmailFailureMessage(code: AgentMailErrorCode): string {
  switch (code) {
    case "unauthorized":
      return "That key was refused by AgentMail. Check it and try again.";
    case "forbidden":
      return "That key is not allowed to use this inbox.";
    case "not_found":
      return "AgentMail has no such inbox or webhook.";
    case "conflict":
      return "AgentMail reported a conflicting request.";
    case "rate_limited":
      return "AgentMail is rate limiting this account. Try again shortly.";
    case "provider_unavailable":
      return "AgentMail is unavailable right now. Try again shortly.";
    case "timeout":
      return "AgentMail did not answer in time. Try again.";
    case "transport_error":
      return "We could not reach AgentMail. Try again.";
    case "invalid_response":
      return "AgentMail returned something we could not read.";
    case "invalid_request":
      return "AgentMail refused that request.";
  }
}

/** Bound a provider identifier before it is stored on one of our rows. */
export function providerId(value: string, field: string): string {
  return boundedString(value, field, { min: 1, max: 400 });
}

/**
 * Pull inbox/thread/message identifiers out of any AgentMail event payload,
 * whichever sub-object carries them. The provider puts them under a different
 * key per event type (`message`, `send`, `delivery`, `bounce`, `complaint`,
 * `reject`), and the ONE definition of that mapping lives here — the inbound
 * route's org binding and the receipt writer must not disagree about
 * which inbox an event names.
 *
 * `open` is deliberately absent: open events are not subscribed to
 * (see `AGENTMAIL_WEBHOOK_EVENT_TYPES`).
 */
export function extractEventIds(event: unknown): {
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
  const inboxId = readString(payload, "inbox_id");
  const threadId = readString(payload, "thread_id");
  const messageId = readString(payload, "message_id");
  return {
    ...(inboxId !== undefined ? { inboxId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
  };
}
