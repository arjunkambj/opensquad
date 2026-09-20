/**
 * Shared domain validators for OpenSquad backend functions.
 *
 * Convex `v.*` validators describe wire/storage shape; they cannot express
 * length or syntax rules, so every `v.string()` that carries a bound is paired
 * with a runtime check here. Call the `assert*`/`normalize*` helpers inside
 * handlers before trusting or storing a value.
 */
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID";

export function domainError(code: DomainErrorCode, message: string): ConvexError<{
  code: DomainErrorCode;
  message: string;
}> {
  return new ConvexError({ code, message });
}

export function invalid(message: string): ConvexError<{
  code: DomainErrorCode;
  message: string;
}> {
  return domainError("INVALID", message);
}

/* ------------------------------------------------------------------ */
/* Bounded strings                                                     */
/* ------------------------------------------------------------------ */

/**
 * Validate that `value` is a string of `min..max` characters after trimming.
 * Returns the trimmed value. All free-text fields pass through this so stored
 * records and public args stay bounded.
 *
 * Fields carved out of `v.any()` payloads (provider result/config
 * envelopes) are `unknown` at runtime — a non-string must be an INVALID
 * rejection, not an uncaught TypeError.
 */
export function boundedString(
  value: string,
  field: string,
  options: { min?: number; max: number },
): string {
  if (typeof value !== "string") {
    throw invalid(`${field} must be a string`);
  }
  const trimmed = value.trim();
  const min = options.min ?? 0;
  if (trimmed.length < min) {
    throw invalid(`${field} must be at least ${min} characters`);
  }
  if (trimmed.length > options.max) {
    throw invalid(`${field} must be at most ${options.max} characters`);
  }
  return trimmed;
}

/** Validate a list of bounded strings with a bounded length. */
export function boundedStringList(
  value: string[],
  field: string,
  options: { maxItems: number; itemMax: number },
): string[] {
  if (value.length > options.maxItems) {
    throw invalid(`${field} allows at most ${options.maxItems} entries`);
  }
  return value.map((entry, index) =>
    boundedString(entry, `${field}[${index}]`, { max: options.itemMax }),
  );
}

/* ------------------------------------------------------------------ */
/* Thrown-error text                                                   */
/* ------------------------------------------------------------------ */

/**
 * Pull the innermost `{code, message}` envelope out of a rethrown
 * `ConvexError`'s text. Returns the input unchanged when there is none.
 *
 * Crossing an action boundary loses `data` entirely — `ctx.runAction` rethrows
 * a plain `Error` whose text is `Uncaught ConvexError: {"code":…,"message":…}`,
 * sometimes nested twice. So the envelope is unwrapped from the text as well;
 * otherwise a reason stored from it reads as JSON with a stack-trace prefix.
 *
 * The envelope is followed by a stack trace, so the object's extent is found
 * by scanning for its own balanced closing brace (string- and escape-aware)
 * rather than by parsing to the end of the text, which never succeeds.
 */
export function unwrapConvexErrorText(raw: string): string {
  let text = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    const start = text.indexOf('{"code":');
    if (start === -1) break;
    const end = balancedObjectEnd(text, start);
    if (end === -1) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      break;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { message?: unknown }).message !== "string"
    ) {
      break;
    }
    text = (parsed as { message: string }).message;
  }
  return text;
}

/** Index just past the `}` that closes the object starting at `start`, or
 *  -1 when the text never closes it. */
export function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The one-line, storable reason inside a thrown error's serialized text.
 *
 * Workflow/runner failures arrive as `message\n<stack>` — the stack names
 * internal file layout and library versions, so it is not a reason and does
 * not belong in a user-facing `failure`, `outcomeReason` or activity summary.
 * A rethrown `ConvexError` envelope is unwrapped to its message first; the
 * surviving first line, minus its `Error:`/`Uncaught` prefix, is bounded to
 * `max` characters. An empty or stack-only input becomes "unknown error"
 * rather than storing whitespace.
 */
export function errorReason(raw: string, max: number): string {
  const unwrapped = unwrapConvexErrorText(raw);
  const firstLine = (unwrapped.split("\n", 1)[0] ?? "").trim();
  const reason = firstLine
    .replace(/^uncaught\s+/i, "")
    .replace(/^[\w$]*Error:\s*/i, "");
  const bounded = (reason.length > 0 ? reason : "unknown error").slice(0, max);
  return bounded;
}

/* ------------------------------------------------------------------ */
/* URLs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Validate and normalize a public `http`/`https` URL. Rejects other schemes,
 * credential-bearing URLs and values the URL parser cannot read. Returns the
 * normalized serialization.
 */
export function normalizeHttpUrl(value: string, field: string): string {
  const trimmed = boundedString(value, field, { min: 1, max: 2048 });
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalid(`${field} must use http or https`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw invalid(`${field} must not contain credentials`);
  }
  return parsed.toString();
}

/* ------------------------------------------------------------------ */
/* Timezones                                                           */
/* ------------------------------------------------------------------ */

/**
 * Validate an IANA timezone name using the runtime's Intl database.
 * Returns the canonical IANA name; throws `INVALID` for unknown zones.
 */
export function assertIanaTimezone(value: string, field = "timezone"): string {
  const trimmed = boundedString(value, field, { min: 1, max: 100 });
  try {
    // Throws RangeError for names outside the IANA database. The resolved
    // name is canonical ("america/new_york" → "America/New_York") so stored
    // values compare equal across case variants.
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed })
      .resolvedOptions().timeZone;
  } catch {
    throw invalid(`${field} must be a valid IANA timezone`);
  }
}

/* ------------------------------------------------------------------ */
/* Numbers, pagination                                                 */
/* ------------------------------------------------------------------ */

export function boundedInt(
  value: number,
  field: string,
  options: { min: number; max: number },
): number {
  if (!Number.isInteger(value)) {
    throw invalid(`${field} must be an integer`);
  }
  if (value < options.min || value > options.max) {
    throw invalid(`${field} must be between ${options.min} and ${options.max}`);
  }
  return value;
}

/* Calendar window for stored application timestamps. A seconds-resolution
 * value or a provider-supplied garbage number is out of range here, so it
 * cannot be stored as a due date, retrieval time or meeting start. */
export const EPOCH_MS_MIN = 1_000_000_000_000;
export const EPOCH_MS_MAX = 4_102_444_800_000;

/** Validate an integer UTC epoch-millisecond timestamp (§4 notation). */
export function assertEpochMs(value: number, field: string): number {
  return boundedInt(value, field, { min: EPOCH_MS_MIN, max: EPOCH_MS_MAX });
}

export const DEFAULT_LIST_LIMIT = 25;
export const MAX_LIST_LIMIT = 50;

/** Clamp an optional client-supplied limit to the standard bounded range. */
export function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  return boundedInt(limit, "limit", { min: 1, max: MAX_LIST_LIMIT });
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export const vRole = v.union(
  v.literal("owner"),
  v.literal("operator"),
  v.literal("viewer"),
);

export const vMembershipStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

/* ------------------------------------------------------------------ */
/* Campaigns                                                           */
/* ------------------------------------------------------------------ */

export const vCampaignStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("completed"),
);

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export const CAMPAIGN_LEAD_LIMIT_MIN = 1;
export const CAMPAIGN_LEAD_LIMIT_MAX = 5;
export const CAMPAIGN_ENRICHMENT_LIMIT_MIN = 0;
export const CAMPAIGN_ENRICHMENT_LIMIT_MAX = 10;
/* ------------------------------------------------------------------ */
/* Providers, digests and reply dispositions                           */
/* ------------------------------------------------------------------ */

/** Paid or metered backends the app records `providerOperations` against. */
export const PROVIDER_KINDS = ["firecrawl", "agentmail"] as const;
export const vProviderKind = v.union(
  v.literal("firecrawl"),
  v.literal("agentmail"),
);
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Small inline document or a private storage reference. */
export const vProviderDataRef = v.union(
  v.object({ kind: v.literal("inline"), value: v.any() }),
  v.object({
    kind: v.literal("storage"),
    storageId: v.id("_storage"),
    byteSize: v.number(),
    digest: v.string(),
  }),
);
export type ProviderDataRef = Infer<typeof vProviderDataRef>;

/** Deterministic JSON serialization (sorted keys, undefined-elided). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** SHA-256 hex digest — WebCrypto (available in Convex mutations/actions). */
export async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** `sha256:<hex>` over the canonical result serialization. */
export async function computeResultDigest(result: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(result))}`;
}

/**
 * The PRODUCT-level meaning of an inbound reply, which is what the inbox row
 * speaks in. `automated` covers out-of-office and bounce alike — the product
 * owes them the same treatment: no draft, no takeover, no inference about
 * interest.
 *
 * A classification is a signal, never an authority: an `unsubscribe`
 * disposition holds the thread for a human, it does not write a suppression
 * row. The deterministic opt-out rule stops a clear unsubscribe on its own
 * (architecture §8 step 6).
 */
export const REPLY_DISPOSITIONS = [
  "interested",
  "question",
  "not_now",
  "not_interested",
  "unsubscribe",
  "automated",
  "needs_review",
] as const;

export const vReplyDisposition = v.union(
  v.literal("interested"),
  v.literal("question"),
  v.literal("not_now"),
  v.literal("not_interested"),
  v.literal("unsubscribe"),
  v.literal("automated"),
  v.literal("needs_review"),
);

export type ReplyDisposition = (typeof REPLY_DISPOSITIONS)[number];

/* ------------------------------------------------------------------ */
/* Correspondence, sending and usage (P10 — architecture §4.3/§4.4/§8)  */
/* ------------------------------------------------------------------ */

/**
 * Activity kinds produced by the P10 correspondence/send modules. `kind` is a
 * bounded string in storage; producers keep to this list so P11/P13 can
 * formalize them later without a data migration.
 */
export const ACTIVITY_KINDS_P10 = [
  "draft_created",
  "draft_revised",
  "approval_recorded",
  "send_attempt_reserved",
  "send_attempt_dispatched",
  "send_attempt_acknowledged",
  "send_attempt_failed",
  "send_attempt_uncertain",
  "send_attempt_cancelled",
  "send_attempt_reconciled",
  "suppression_added",
  "suppression_removed",
  "delivery_receipt_applied",
  "delivery_receipt_parked",
  "conversation_thread_link_missed",
] as const;

export type ActivityKindP10 = (typeof ACTIVITY_KINDS_P10)[number];

/**
 * Activity kinds produced by the P11 inbound/reply modules. Same rule as the
 * P10 list: `kind` is a bounded string in storage and producers keep to this
 * list, which is the single definition site.
 */
export const ACTIVITY_KINDS_P11 = ["reply_classified"] as const;

export type ActivityKindP11 = (typeof ACTIVITY_KINDS_P11)[number];

/* ----- conversation/draft/approval/send-attempt state unions -------- */

export const vConversationState = v.union(
  v.literal("open"),
  v.literal("closed"),
  v.literal("unassigned"),
);

export type ConversationState = "open" | "closed" | "unassigned";

/**
 * Why automation is frozen on a conversation (`conversations.takeoverReason`).
 *
 * `humanTakeover` alone cannot tell an operator's deliberate hold from one the
 * system placed, and the inbox needs that distinction *before* offering
 * Resume. The reason therefore lives on the conversation row.
 *
 * - `unassigned_inbound` — verified mail on a known inbox matched no thread.
 * - `operator` — a human pressed Take over.
 * - `ambiguous_opt_out` — the reply may be an opt-out; a human decides.
 * - `awaiting_resume` — a lead was associated, or a closed thread reopened;
 *   automation stays frozen until `conversations.resume` re-runs the policy.
 * - `needs_review` — classification could not be trusted.
 */
export const TAKEOVER_REASONS = [
  "unassigned_inbound",
  "operator",
  "ambiguous_opt_out",
  "awaiting_resume",
  "needs_review",
] as const;

export const vTakeoverReason = v.union(
  v.literal("unassigned_inbound"),
  v.literal("operator"),
  v.literal("ambiguous_opt_out"),
  v.literal("awaiting_resume"),
  v.literal("needs_review"),
);

export type TakeoverReason = (typeof TAKEOVER_REASONS)[number];

/**
 * `conversationNotes.kind`. `note` is a human annotation; `system` is a
 * lifecycle record the backend wrote. Neither can ever resolve a business
 * approval.
 */
export const CONVERSATION_NOTE_KINDS = ["note", "system"] as const;

export const vConversationNoteKind = v.union(
  v.literal("note"),
  v.literal("system"),
);

export type ConversationNoteKind = (typeof CONVERSATION_NOTE_KINDS)[number];

/**
 * The inbox tabs `plan/ux.md` §48 puts in the URL. Each one is a single exact
 * index range on `conversations`; there is no post-filtered tab, because a
 * post-filtered truncated page is not a filtered result (architecture §5).
 */
export const CONVERSATION_TABS = [
  "open",
  "unassigned",
  "takeover",
  "closed",
] as const;

export const vConversationTab = v.union(
  v.literal("open"),
  v.literal("unassigned"),
  v.literal("takeover"),
  v.literal("closed"),
);

export type ConversationTab = (typeof CONVERSATION_TABS)[number];

/** Bound on one `conversationNotes.body`. */
export const CONVERSATION_NOTE_BODY_MAX_LENGTH = 4_000;

/**
 * How much inbound text the deterministic opt-out rule scans. The scan runs on
 * the reply's own text, never on the quoted history — a reply that quotes our
 * own footer must not suppress the recipient we just mailed.
 */
export const INBOUND_BODY_SCAN_MAX_LENGTH = 4_000;

/**
 * How much inbound text may ride into a model request as labelled untrusted
 * context. Email bodies are the prompt-injection vector: they are data, never
 * instruction, and they are never concatenated into the instruction itself.
 */
export const INBOUND_BODY_CONTEXT_MAX_LENGTH = 8_000;

/**
 * How much of a message body a thread view returns. Plain text only — `html`
 * is never projected, which removes raw-HTML injection and remote
 * tracking-image loads at the source rather than at the renderer.
 */
export const THREAD_BODY_MAX_LENGTH = 20_000;

/** Provider endpoint an attempt targets (integrations.md §G3 step 5). */
export const vEndpointOperation = v.union(
  v.literal("send"),
  v.literal("reply"),
);

export type EndpointOperation = "send" | "reply";

/**
 * §4.3 `sendAttempts.state`. `acknowledged` means the provider accepted the
 * message ("Sent") — never "Delivered"; delivery facts arrive only through
 * verified provider events.
 */
export const vSendAttemptState = v.union(
  v.literal("reserved"),
  v.literal("requesting"),
  v.literal("acknowledged"),
  v.literal("uncertain"),
  v.literal("definitively_failed"),
  v.literal("cancelled"),
);

export type SendAttemptState =
  | "reserved"
  | "requesting"
  | "acknowledged"
  | "uncertain"
  | "definitively_failed"
  | "cancelled";

/**
 * Attempt states that block ANY new send on the conversation across all
 * draft revisions (§8.3).
 */
export const UNRESOLVED_ATTEMPT_STATES: readonly SendAttemptState[] = [
  "reserved",
  "requesting",
  "uncertain",
];

/** The immutable content verdict recorded on an `approvals` row. */
export const vApprovalVerdict = v.union(
  v.literal("approved"),
  v.literal("rejected"),
);

export type ApprovalVerdict = "approved" | "rejected";

/**
 * How a draft approval was resolved, so a caller can tell a redraft request
 * from a deliberate rejection. `approved` is the only value that produces an
 * `approved` approvals row.
 */
export const DRAFT_RESOLUTIONS = [
  "approved",
  "changes_requested",
  "rejected",
] as const;

export type DraftResolution = (typeof DRAFT_RESOLUTIONS)[number];

/* ----- suppressions -------------------------------------------------- */

export const vSuppressionKind = v.union(
  v.literal("email"),
  v.literal("domain"),
);

export type SuppressionKind = "email" | "domain";

export const vSuppressionReason = v.union(
  v.literal("unsubscribe"),
  v.literal("manual"),
  v.literal("bounce"),
  v.literal("provider"),
);

export type SuppressionReason = "unsubscribe" | "manual" | "bounce" | "provider";

/* ----- email normalization ------------------------------------------- */

export const EMAIL_ADDRESS_MAX_LENGTH = 320;
export const EMAIL_LOCAL_PART = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
export const EMAIL_DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Canonical recipient identity for approvals, suppressions and payload
 * hashing: trimmed, lowercased `local@domain`, one `@`, a dot-ful
 * domain. Normalization is deliberately small and deterministic — no plus
 * stripping or provider-specific rewriting, so the address sent is the
 * address approved.
 */
export function normalizeEmailAddress(
  value: string,
  field = "recipient",
): string {
  const trimmed = boundedString(value, field, {
    min: 3,
    max: EMAIL_ADDRESS_MAX_LENGTH,
  }).toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at !== trimmed.indexOf("@") || at === trimmed.length - 1) {
    throw invalid(`${field} must be a single email address`);
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!EMAIL_LOCAL_PART.test(local)) {
    throw invalid(`${field} has an invalid local part`);
  }
  if (!EMAIL_DOMAIN.test(domain)) {
    throw invalid(`${field} has an invalid domain`);
  }
  return `${local}@${domain}`;
}

/**
 * Normalize a bare domain for `kind: "domain"` suppressions: trims a leading
 * `@` or `mailto:`-style noise, lowercases, requires at least one dot so a
 * bare TLD/host label can never suppress an entire suffix.
 */
export function normalizeDomain(value: string, field = "domain"): string {
  const trimmed = boundedString(value, field, { min: 1, max: 253 })
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\.+$/, "");
  if (!EMAIL_DOMAIN.test(trimmed)) {
    throw invalid(`${field} must be a valid dotted domain`);
  }
  return trimmed;
}

/** The domain part of an already-normalized email address. */
export function domainOfNormalizedEmail(normalizedEmail: string): string {
  return normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);
}

/* ----- deterministic opt-out detection -------------------------------- */

/**
 * How strongly an inbound message asks to be left alone (architecture §8
 * step 6: "evaluate an explicit deterministic opt-out rule before any new
 * send; ambiguous opt-out intent pauses outreach for review. Do not wait for
 * an optional model classification to stop a clear unsubscribe.").
 *
 * Three values, and the middle one is the point of the whole design:
 *
 * - `explicit` — an unambiguous opt-out sentence. Suppresses immediately,
 *   without waiting for any model.
 * - `ambiguous` — the words are there but the request is not. Automation
 *   STOPS and a human decides. It writes NO suppression row:
 *   `vSuppressionReason` is a closed union of `unsubscribe | manual | bounce
 *   | provider` and there is deliberately no "something guessed so".
 * - `none` — no opt-out language at all.
 *
 * This is a rule over text, never a classifier. It runs on the reply's own
 * words and it errs toward `ambiguous`, because an `explicit` false positive
 * silently ends a real conversation while an `ambiguous` false positive only
 * asks a human to look.
 */
export const OPT_OUT_SIGNALS = ["none", "ambiguous", "explicit"] as const;

export const vOptOutSignal = v.union(
  v.literal("none"),
  v.literal("ambiguous"),
  v.literal("explicit"),
);

export type OptOutSignal = (typeof OPT_OUT_SIGNALS)[number];

/** Rank so the strongest signal across subject and body wins. */
const OPT_OUT_RANK: Record<OptOutSignal, number> = {
  none: 0,
  ambiguous: 1,
  explicit: 2,
};

/**
 * Cut an inbound body down to the reply's OWN words, dropping quoted history
 * and the sender's signature block.
 *
 * Without this, every reply that quotes our outbound footer would read as an
 * unsubscribe request and suppress the recipient we had just mailed — the
 * scan would be matching our own text. Cutting at the signature delimiter
 * matters for the same reason in the other direction: a corporate auto-footer
 * is boilerplate, not a request.
 *
 * Deliberately conservative. Cutting too early can only WEAKEN a signal, and a
 * weakened signal means a human looks at the message.
 */
export function stripQuotedReply(text: string): string {
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      // A quoted line, in every client that marks them.
      trimmed.startsWith(">") ||
      // RFC 3676 signature delimiter.
      trimmed === "--" ||
      // "On <date>, <someone> wrote:" — the attribution above a quote.
      /\bwrote:\s*$/i.test(trimmed) ||
      /^-{2,}\s*original message\s*-{2,}$/i.test(trimmed) ||
      /^-{3,}\s*forwarded message\s*-{3,}$/i.test(trimmed) ||
      // Outlook's horizontal rule above the quoted header block.
      /^_{10,}$/.test(trimmed)
    ) {
      break;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/** Lowercase, collapse whitespace, fold smart quotes — nothing else. */
function normalizeScanText(value: string): string {
  return value
    .slice(0, INBOUND_BODY_SCAN_MAX_LENGTH)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The whole message, once trailing punctuation is discounted. */
function bareText(scan: string): string {
  return scan.replace(/[.!?,;:\s]+$/, "");
}

type OptOutRule = { rule: string; matches: (scan: string) => boolean };

/**
 * Unambiguous opt-out sentences. Each one is a request addressed to us; none
 * of them can be satisfied by a passing mention of the word.
 *
 * `opt out` on its own is NOT here — "we decided to opt out of the
 * conference" is a normal sentence — so it ranks ambiguous instead.
 */
const EXPLICIT_OPT_OUT_RULES: readonly OptOutRule[] = [
  { rule: "unsubscribe_me", matches: (s) => s.includes("unsubscribe me") },
  {
    rule: "please_unsubscribe",
    matches: (s) => s.includes("please unsubscribe"),
  },
  { rule: "unsubscribe_bare", matches: (s) => bareText(s) === "unsubscribe" },
  {
    rule: "remove_from_list",
    matches: (s) =>
      /\bremove (?:me|us) from (?:your|this|the|our)[a-z ]{0,24}\blist\b/.test(s),
  },
  {
    rule: "take_off_list",
    matches: (s) =>
      /\btake (?:me|us) off (?:of )?(?:your|this|the|our)[a-z ]{0,24}\blist\b/.test(
        s,
      ),
  },
  {
    rule: "stop_emailing",
    matches: (s) =>
      /\bstop (?:emailing|e-mailing|contacting|messaging) (?:me|us)\b/.test(s) ||
      /\bstop sending (?:me|us)\b/.test(s),
  },
  {
    rule: "do_not_contact",
    matches: (s) =>
      /\b(?:do not|don't|dont) (?:contact|email|e-mail|message) (?:me|us)\b/.test(
        s,
      ),
  },
  { rule: "opt_me_out", matches: (s) => /\bopt (?:me|us) out\b/.test(s) },
];

/**
 * Language that MIGHT be an opt-out. Every one of these stops automation and
 * asks a human; none of them writes a suppression row.
 *
 * `not interested` and `no thanks` are deliberately absent. They are
 * classifications, not opt-outs — freezing them here would take the reply away
 * from the classifier that exists to handle them.
 */
const AMBIGUOUS_OPT_OUT_RULES: readonly OptOutRule[] = [
  { rule: "mentions_unsubscribe", matches: (s) => s.includes("unsubscribe") },
  { rule: "opt_out_phrase", matches: (s) => /\bopt(?:ing|ed)? out\b/.test(s) },
  { rule: "remove_me", matches: (s) => /\bremove (?:me|us)\b/.test(s) },
  { rule: "take_me_off", matches: (s) => /\btake (?:me|us) off\b/.test(s) },
  { rule: "bare_stop", matches: (s) => bareText(s) === "stop" },
];

function scanOptOut(scan: string): { signal: OptOutSignal; rule?: string } {
  if (scan.length === 0) {
    return { signal: "none" };
  }
  for (const candidate of EXPLICIT_OPT_OUT_RULES) {
    if (candidate.matches(scan)) {
      return { signal: "explicit", rule: candidate.rule };
    }
  }
  for (const candidate of AMBIGUOUS_OPT_OUT_RULES) {
    if (candidate.matches(scan)) {
      return { signal: "ambiguous", rule: candidate.rule };
    }
  }
  return { signal: "none" };
}

/**
 * The deterministic opt-out rule, run over an inbound message's own text.
 *
 * Body text is `extracted_text` when AgentMail supplied it (its own
 * reply extraction) and `stripQuotedReply(text)` otherwise. `html` is never
 * scanned — markup would let the same words hide behind tags.
 *
 * An inbound `List-Unsubscribe` header is NOT consulted, here or anywhere: it
 * is the sender's own footer advertising how to leave THEIR list, not a
 * request addressed to us. Nothing in the return value is derived from a
 * header.
 *
 * The result travels onward as an enum plus the name of the rule that fired —
 * never a slice of the message. The operator reads the message itself in the
 * thread view; a second copy of it in an app table is what §4.3 rules out.
 */
export function evaluateOptOutText(args: {
  subject?: unknown;
  text?: unknown;
  extractedText?: unknown;
}): { signal: OptOutSignal; rule?: string } {
  const body =
    typeof args.extractedText === "string" && args.extractedText.length > 0
      ? args.extractedText
      : typeof args.text === "string"
        ? stripQuotedReply(args.text)
        : "";
  const scans = [
    typeof args.subject === "string" ? normalizeScanText(args.subject) : "",
    normalizeScanText(body),
  ];
  let best: { signal: OptOutSignal; rule?: string } = { signal: "none" };
  for (const scan of scans) {
    const found = scanOptOut(scan);
    if (OPT_OUT_RANK[found.signal] > OPT_OUT_RANK[best.signal]) {
      best = found;
    }
  }
  return best;
}

/** Longest inbound `From` header this will even look at. */
export const INBOUND_SENDER_MAX_LENGTH = 1_000;

/**
 * Read a single normalized address out of an inbound `From` header, or
 * nothing.
 *
 * The header is written by whoever sent the mail, so this is a parser for
 * untrusted data and never an identity check. Two properties matter:
 *
 * - it NEVER throws, unlike `normalizeEmailAddress`. The inbound callbacks it
 *   feeds cannot survive a throw (Workpool does not retry mutations), so a
 *   malformed header must degrade to "unknown sender", not lose the event;
 * - it REFUSES rather than guesses. A header listing several addresses, or one
 *   whose address does not normalize, yields `undefined`. Downstream that is a
 *   refusal — `conversations.resume` blocks on `sender_unverified` — so
 *   refusing is always the safe answer.
 *
 * The result is stored as data. It never selects a workspace or conversation
 * and never becomes a send recipient; at most it must MATCH an address the
 * application already resolved, and a mismatch blocks.
 */
export function parseInboundSender(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > INBOUND_SENDER_MAX_LENGTH) {
    return undefined;
  }
  // `Display Name <a@b.com>` — take the angle-bracket address when the header
  // carries exactly one, else the whole trimmed header.
  const angles = trimmed.match(/<[^<>]*>/g);
  if (angles !== null && angles.length > 1) {
    return undefined;
  }
  const candidate = (
    angles === null ? trimmed : angles[0].slice(1, -1)
  ).trim();
  try {
    return normalizeEmailAddress(candidate, "sender");
  } catch {
    return undefined;
  }
}

/* ----- draft payload hashing ------------------------------------------ */

export const DRAFT_SUBJECT_MAX_LENGTH = 200;
export const DRAFT_BODY_MAX_LENGTH = 12_000;
export const DRAFT_EVIDENCE_MAX_ITEMS = 25;
export const DRAFT_EVIDENCE_ID_MAX_LENGTH = 128;
export const PROVIDER_REF_MAX_LENGTH = 400;

/**
 * The exact fields a send commits to (§8 "Exact draft approval"): sender
 * inbox, normalized recipient, subject, body, the reply parent and which
 * provider endpoint carries it. Evidence links and context versions are
 * approval inputs, not send payload — they live on the draft row and on the
 * approvals record instead of inside the hash.
 */
export type DraftPayloadFingerprint = {
  endpointOperation: EndpointOperation;
  inboxRef: string;
  normalizedRecipient: string;
  subject: string;
  body: string;
  replyToMessageRef: string | null;
};

/** SHA-256 hex of the canonical fingerprint — the stored `payloadHash`. */
export async function computePayloadHash(
  payload: DraftPayloadFingerprint,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(payload)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/* ----- usage accounting ------------------------------------------------ */

export const vUsageMetric = v.union(
  v.literal("sends"),
  v.literal("research_pages"),
  v.literal("research_searches"),
);

export type UsageMetric = "sends" | "research_pages" | "research_searches";

/**
 * §4.4 provider tool-invocation lifecycle. `requested` is recorded BEFORE
 * the provider is contacted and `accepted` once the provider acknowledged a
 * durable job, so a crash between the two is always visible as an operation
 * that may have been billed. `uncertain` deliberately keeps its reservation
 * blocking capacity: an ambiguous failure consumes the allowance until
 * something reconciles it, which is the only honest accounting when we
 * cannot tell whether we were charged.
 */
export const PROVIDER_OPERATION_STATES = [
  "requested",
  "accepted",
  "completed",
  "uncertain",
  "failed",
] as const;
export const vProviderOperationState = v.union(
  v.literal("requested"),
  v.literal("accepted"),
  v.literal("completed"),
  v.literal("uncertain"),
  v.literal("failed"),
);
export type ProviderOperationState =
  (typeof PROVIDER_OPERATION_STATES)[number];

/**
 * How ONE provider operation's reservation was settled — recorded on the
 * operation row itself, because the row's `state` does not imply it.
 *
 * A post-fetch URL-policy refusal is the case that forces this: Firecrawl
 * fetched the page and billed us, and the redirect target is then refused,
 * so the operation is `failed` AND `commit`-settled. Counting a prospect's
 * spend by `state !== "failed"` let that billed retrieval escape the
 * per-prospect page cap. Counting by settlement cannot: `release` is the
 * only outcome that proves the provider was never reached.
 */
export const vProviderOperationSettlement = v.union(
  v.literal("commit"),
  v.literal("release"),
  v.literal("markUncertain"),
);
export type ProviderOperationSettlement = Infer<
  typeof vProviderOperationSettlement
>;

/**
 * Does this operation's receipt consume the prospect's page allowance?
 *
 * Everything except a released reservation does. A row with no recorded
 * settlement is still in flight (`requested`/`accepted`) and its
 * reservation is live, so it counts too — an unsettled operation must never
 * be free.
 */
export function consumesPageAllowance(row: {
  settlement?: ProviderOperationSettlement;
}): boolean {
  return row.settlement !== "release";
}

/**
 * §G2 Firecrawl route item 2: homepage plus at most two relevant pages per
 * prospect. Three is the per-prospect cap AND the per-prospect share of the
 * campaign's page allowance.
 */
export const RESEARCH_PAGES_PER_PROSPECT = 3;

/**
 * The campaign's lifetime research-page allowance: its accepted-lead ceiling
 * times the per-prospect page cap.
 */
export function researchPageLimit(leadLimit: number): number {
  return (
    boundedInt(leadLimit, "campaign.leadLimit", {
      min: CAMPAIGN_LEAD_LIMIT_MIN,
      max: CAMPAIGN_LEAD_LIMIT_MAX,
    }) * RESEARCH_PAGES_PER_PROSPECT
  );
}

/**
 * One page the BACKEND itself retrieved, in the shape the app stores and
 * cites. `retrievedAt` is epoch ms — `scrapePage` reports an ISO 8601
 * string, and the conversion happens once, here at the boundary, rather
 * than being repeated (and eventually mis-repeated) at each read site.
 */
export const vRetrievedPage = v.object({
  url: v.string(),
  retrievedAt: v.number(),
  excerpt: v.string(),
  statusCode: v.optional(v.number()),
  truncated: v.boolean(),
  providerOperationId: v.id("providerOperations"),
});
export type RetrievedPage = Infer<typeof vRetrievedPage>;

export const vUsageReservationState = v.union(
  v.literal("reserved"),
  v.literal("committed"),
  v.literal("released"),
  v.literal("uncertain"),
);

export type UsageReservationState =
  | "reserved"
  | "committed"
  | "released"
  | "uncertain";

/* ----- provider event receipts ------------------------------------------ */

export const vEmailEventHandlingState = v.union(
  v.literal("pending"),
  v.literal("handled"),
  v.literal("failed"),
);

export type EmailEventHandlingState = "pending" | "handled" | "failed";

/**
 * Which half of the mail path a receipt belongs to.
 *
 * It exists so the inbound drain can RANGE over inbound rows rather than
 * filter a fixed page after taking it. The two halves reach a terminal
 * `handlingState` by completely different routes — an inbound row through
 * `inbox.applyInboundMessage`, an outbound one only once a send attempt
 * carries its `providerMessageRef` — so an outbound receipt that never
 * matches an attempt stays `pending` forever. Scanning `handlingState` alone,
 * oldest first, therefore hands the inbound sweep a page made entirely of
 * those rows, and the recovery path for a lost inbound callback stops running
 * with no error to say so.
 */
export const vEmailEventDirection = v.union(
  v.literal("inbound"),
  v.literal("outbound"),
);

export type EmailEventDirection = "inbound" | "outbound";

/** Prefix of every inbound application key. */
export const INBOUND_APPLICATION_KEY_PREFIX = "incoming:";

/**
 * Derive a receipt's direction from its application key — TOTAL, and
 * deliberately biased to `outbound` for anything that is not recognisably an
 * inbound key, because `outbound` is the half the inbound drain never feeds
 * to `applyInboundMessage`.
 */
export function directionForApplicationKey(
  applicationKey: string,
): EmailEventDirection {
  return applicationKey.startsWith(INBOUND_APPLICATION_KEY_PREFIX)
    ? "inbound"
    : "outbound";
}

/**
 * Application handling key for inbound messages
 * (`incoming:<inbox>:<message>`) — a second provider event ID for the same
 * message can never advance the conversation twice (§4.3 note). Outbound
 * delivery events use `outbound:<messageRef>:<eventType>` instead.
 */
export function inboundApplicationKey(inboxRef: string, messageRef: string) {
  return `${INBOUND_APPLICATION_KEY_PREFIX}${inboxRef}:${messageRef}`;
}

export function outboundApplicationKey(
  messageRef: string,
  eventType: string,
) {
  return `outbound:${messageRef}:${eventType}`;
}

/* ----- quarantined provider events -------------------------------------- */

/**
 * Why a verified event could not be attributed to a workspace.
 *
 * Both are resolvable conditions, not corruption: an inbox assignment that
 * has not committed yet (or is being rotated), and two workspaces
 * transiently claiming one `inboxRef`. Neither may be guessed at by the
 * callback — §8 step 2 resolves a workspace from the saved assignment alone —
 * and neither may drop the event, because the provider will not resend an
 * `event_id` the component has already ingested.
 */
export const vQuarantineReason = v.union(
  v.literal("inbox_unassigned"),
  v.literal("inbox_ambiguous"),
);

export type QuarantineReason = "inbox_unassigned" | "inbox_ambiguous";

/**
 * `quarantined` — held, replayable. `released` — replayed into the normal
 * receipt path once the inbox assignment existed. `discarded` — it can never
 * be replayed and somebody said so; the row stays as the record that it
 * arrived.
 */
export const vQuarantineState = v.union(
  v.literal("quarantined"),
  v.literal("released"),
  v.literal("discarded"),
);

export type QuarantineState = "quarantined" | "released" | "discarded";

/* ----- send window / local-day helpers (IANA timezone) ------------------ */

/**
 * Local wall-clock parts of `atMs` in `timezone`, read through `Intl`.
 * `weekday` is the civil weekday (0 = Sunday … 6 = Saturday); `minuteOfDay`
 * is minutes after local midnight.
 */
export function localDayParts(
  atMs: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minuteOfDay: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(atMs));
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = (
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
  ).indexOf(read("weekday") as "Sun");
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const result = {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    weekday,
    minuteOfDay: hour * 60 + minute,
  };
  if (
    weekday < 0 ||
    !Number.isFinite(result.year) ||
    !Number.isFinite(result.month) ||
    !Number.isFinite(result.day) ||
    !Number.isFinite(result.minuteOfDay)
  ) {
    throw invalid(`timezone ${timezone} produced unreadable local time`);
  }
  return result;
}

/** `YYYY-MM-DD` local date of `atMs` in `timezone` — the sends period key. */
export function localDayKey(atMs: number, timezone: string): string {
  const parts = localDayParts(atMs, timezone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Best-effort UTC instant for a civil local date + minute-of-day in
 * `timezone`, without a timezone database library: guess the civil time as
 * UTC, measure the zone's offset at the guess and correct. Converges in two
 * or three iterations; across a DST "gap" (a local time that never occurs)
 * it lands on a boundary instant — acceptable for a wait-until hint because
 * the send window is re-validated before dispatch.
 */
export function localCivilToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timezone: string,
): number {
  const desired =
    Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;
  let guess = desired;
  for (let i = 0; i < 4; i++) {
    const actual = localDayParts(guess, timezone);
    const actualMs =
      Date.UTC(actual.year, actual.month - 1, actual.day) +
      actual.minuteOfDay * 60_000;
    const diff = desired - actualMs;
    if (diff === 0) {
      break;
    }
    guess += diff;
  }
  return guess;
}

export type SendWindowStatus =
  | { permitted: true; localDayKey: string }
  | { permitted: false; localDayKey: string; nextPermittedAt: number };

/**
 * Evaluate the workspace's IANA send window at `atMs`. When outside the
 * window, returns the next UTC instant the window opens (§8.2 — the caller
 * waits durably, then re-runs the whole preflight).
 */
export function sendWindowStatus(
  workspace: {
    timezone: string;
    sendWindow: { weekdays: number[]; startMinute: number; endMinute: number };
  },
  atMs: number,
): SendWindowStatus {
  const { timezone, sendWindow } = workspace;
  const todayKey = localDayKey(atMs, timezone);
  const now = localDayParts(atMs, timezone);
  const withinToday =
    sendWindow.weekdays.includes(now.weekday) &&
    now.minuteOfDay >= sendWindow.startMinute &&
    now.minuteOfDay < sendWindow.endMinute;
  if (withinToday) {
    return { permitted: true, localDayKey: todayKey };
  }
  // Scan civil days forward from "today" in the workspace timezone. Weekday
  // is a property of the civil date, so it is timezone-independent.
  for (let offset = 0; offset <= 8; offset++) {
    const civil = new Date(
      Date.UTC(now.year, now.month - 1, now.day + offset),
    );
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    const weekday = civil.getUTCDay();
    if (!sendWindow.weekdays.includes(weekday)) {
      continue;
    }
    const startUtc = localCivilToUtc(
      year,
      month,
      day,
      sendWindow.startMinute,
      timezone,
    );
    const endUtc = localCivilToUtc(
      year,
      month,
      day,
      sendWindow.endMinute,
      timezone,
    );
    if (offset === 0 && atMs >= endUtc) {
      continue; // today's window already closed
    }
    if (atMs < startUtc) {
      return {
        permitted: false,
        localDayKey: todayKey,
        nextPermittedAt: startUtc,
      };
    }
    // offset === 0 && within was handled above; offset > 0 always opens in
    // the future.
    if (offset > 0) {
      return {
        permitted: false,
        localDayKey: todayKey,
        nextPermittedAt: startUtc,
      };
    }
  }
  // weekdays is validated non-empty (1–7 entries), so a permitted day always
  // exists within eight days; reaching this means the window opens on a
  // further day — report the same instant bounded at +8 days for safety.
  const civil = new Date(Date.UTC(now.year, now.month - 1, now.day + 8));
  return {
    permitted: false,
    localDayKey: todayKey,
    nextPermittedAt: localCivilToUtc(
      civil.getUTCFullYear(),
      civil.getUTCMonth() + 1,
      civil.getUTCDate(),
      sendWindow.startMinute,
      timezone,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Leads, bookings and evidence (P20 — §4.3/§4.5/§8 CRM and booking)   */
/*                                                                     */
/* Contract only: these validators and bounds are the single           */
/* definition P09, P11, P19 and P21 import. Widening a union here is a  */
/* deliberate edit at one site — none of those cards may re-declare a   */
/* parallel vocabulary.                                                */
/* ------------------------------------------------------------------ */

/**
 * The ordered sales pipeline (§4.3). Order is load-bearing twice: a later
 * scrape may never move a lead backwards, and cancelling a booking falls back
 * to "the last supported earlier stage". `won`/`lost` close the pipeline and
 * are never inferred from mail acceptance or a booked meeting.
 */
export const SALES_STAGES = [
  "discovered",
  "researched",
  "qualified",
  "contact_needed",
  "draft_ready",
  "contacted",
  "replied",
  "booking_proposed",
  "booked",
  "won",
  "lost",
] as const;

export const vSalesStage = v.union(
  v.literal("discovered"),
  v.literal("researched"),
  v.literal("qualified"),
  v.literal("contact_needed"),
  v.literal("draft_ready"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("booking_proposed"),
  v.literal("booked"),
  v.literal("won"),
  v.literal("lost"),
);

export type SalesStage = (typeof SALES_STAGES)[number];

/** Closed outcomes — an automatic transition never leaves or enters these. */
export const TERMINAL_SALES_STAGES: readonly SalesStage[] = ["won", "lost"];

/** Position in `SALES_STAGES`; the basis for the no-regression comparison. */
export function salesStageRank(stage: SalesStage): number {
  return SALES_STAGES.indexOf(stage);
}

/**
 * The stage an AUTOMATIC transition may land on, or the current one. A later
 * scrape may never move a lead backwards, and an automatic transition never
 * enters or leaves `won`/`lost` — both halves of what `salesStageRank` is
 * load-bearing for. Returning the CURRENT stage rather than throwing is
 * deliberate: a branch that re-runs research on an already-contacted lead
 * should record its finding, not fail. Human corrections do not come through
 * here — `prospects.updateStage` moves to ANY stage with a stated reason.
 */
export function advancedStage(
  current: SalesStage,
  target: SalesStage,
): SalesStage {
  if (TERMINAL_SALES_STAGES.includes(current)) return current;
  if (TERMINAL_SALES_STAGES.includes(target)) return current;
  return salesStageRank(target) > salesStageRank(current) ? target : current;
}

/**
 * Qualification is orthogonal to `salesStage` and to contact availability: a
 * missing email must not erase fit evidence, and a qualified lead with no
 * address is `contact_needed`, not `rejected` (§4.3).
 */
export const vQualification = v.union(
  v.literal("pending"),
  v.literal("qualified"),
  v.literal("rejected"),
  v.literal("needs_review"),
);

export type Qualification =
  | "pending"
  | "qualified"
  | "rejected"
  | "needs_review";

/**
 * Provenance origin of a source reference or contact. `manual` is an operator
 * typing a company in; `enrich` is the B2B data API. Widening this union is a
 * deliberate edit at one site.
 */
export const vProspectSource = v.union(
  v.literal("manual"),
  v.literal("enrich"),
);

export type ProspectSource = Infer<typeof vProspectSource>;

/**
 * Observed metric metadata carried on a source reference. Always explicit
 * name/currency/period — a bare number would let "$40k" and "40k signups"
 * merge. `currency`/`period` stay optional so a non-revenue metric is not
 * forced to invent them (§4.5: no invented metrics).
 */
export const vObservedMetric = v.object({
  name: v.string(),
  value: v.number(),
  currency: v.optional(v.string()),
  period: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
});

/**
 * One source reference: which source, the profile URL it was read from, the
 * provider record ID where the provider exposes one, when it was retrieved
 * and any observed metric. Re-discovery MERGES these; provenance is never
 * overwritten, and companies are never merged by display name alone (§4.3).
 */
export const vProspectSourceRef = v.object({
  source: vProspectSource,
  profileUrl: v.string(),
  providerRecordId: v.optional(v.string()),
  retrievedAt: v.number(),
  metric: v.optional(vObservedMetric),
});

export type ProspectSourceRef = Infer<typeof vProspectSourceRef>;

export const PROSPECT_SOURCE_REFS_MAX = 10;
export const PROSPECT_COMPANY_NAME_MAX_LENGTH = 200;
export const PROSPECT_FIT_REASON_MAX_LENGTH = 2_000;
export const PROSPECT_STAGE_REASON_MAX_LENGTH = 500;
export const PROVIDER_RECORD_ID_MAX_LENGTH = 200;
export const CANONICAL_DOMAIN_MAX_LENGTH = 253;

/**
 * Canonical dedupe domain for `by_workspaceId_and_campaignId_and_canonicalDomain`.
 * Accepts a bare host or an http(s) URL and extracts the host through the URL
 * parser (so a path, query or credentials cannot leak into the key),
 * lowercases, drops a trailing root dot and drops a leading `www.` — the one
 * subdomain that never identifies a different business. Every OTHER subdomain
 * is preserved, per §4.3.
 *
 * Plain-host only: the shared dotted-domain floor ends in `[a-z]{2,63}`, so a
 * punycode TLD (`xn--p1ai`) is rejected rather than stored.
 *
 * This is a syntax-and-host floor, NOT public-suffix awareness: no suffix list
 * is bundled, so `a.co.uk` and `b.co.uk` stay distinct (correct) but a
 * registrable base cannot be computed. Deepen it HERE so every writer shares
 * one key.
 */
export function normalizeCanonicalDomain(
  value: string,
  field = "canonicalDomain",
): string {
  const trimmed = boundedString(value, field, { min: 1, max: 2048 });
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  // Reject a non-http(s) scheme outright rather than parsing it for a host —
  // `ftp://evil.com` is not a company website and must not become a dedupe key.
  if (scheme !== null && !/^https?$/i.test(scheme[1])) {
    throw invalid(`${field} must be a domain or an http(s) URL`);
  }
  const withScheme = scheme === null ? `https://${trimmed}` : trimmed;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    throw invalid(`${field} must be a domain or an http(s) URL`);
  }
  const normalized = host
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/^www\./, "");
  if (!EMAIL_DOMAIN.test(normalized)) {
    throw invalid(`${field} must be a valid dotted public domain`);
  }
  return boundedString(normalized, field, {
    min: 3,
    max: CANONICAL_DOMAIN_MAX_LENGTH,
  });
}

/**
 * Bound and de-duplicate a prospect's source references. Distinctness is by
 * (source, provider record ID) and falls back to the normalized profile URL
 * when the provider exposes no ID, so re-discovering the same provider record
 * merges instead of consuming one of the ten slots. Returns the normalized
 * list to store.
 */
export function assertSourceRefs(
  refs: ProspectSourceRef[],
  field = "sourceRefs",
): ProspectSourceRef[] {
  if (refs.length === 0) {
    throw invalid(`${field} must carry at least one actual source reference`);
  }
  // Cheap guard before the normalize/dedupe pass: distinctness can only shrink
  // the list, so anything past the cap in RAW length can never fit, and paying
  // a URL parse per element first lets an oversized payload buy unbounded work
  // inside the caller's transaction.
  if (refs.length > PROSPECT_SOURCE_REFS_MAX) {
    throw invalid(
      `${field} allows at most ${PROSPECT_SOURCE_REFS_MAX} source references`,
    );
  }
  const seen = new Set<string>();
  const normalized = refs.map((ref, index) => {
    const at = `${field}[${index}]`;
    const profileUrl = normalizeHttpUrl(ref.profileUrl, `${at}.profileUrl`);
    const providerRecordId =
      ref.providerRecordId === undefined
        ? undefined
        : boundedString(ref.providerRecordId, `${at}.providerRecordId`, {
            min: 1,
            max: PROVIDER_RECORD_ID_MAX_LENGTH,
          });
    const identity = `${ref.source}:${providerRecordId ?? profileUrl}`;
    if (seen.has(identity)) {
      return null;
    }
    seen.add(identity);
    return {
      source: ref.source,
      profileUrl,
      ...(providerRecordId === undefined ? {} : { providerRecordId }),
      retrievedAt: assertEpochMs(ref.retrievedAt, `${at}.retrievedAt`),
      ...(ref.metric === undefined
        ? {}
        : { metric: assertObservedMetric(ref.metric, `${at}.metric`) }),
    } satisfies ProspectSourceRef;
  });
  const distinct = normalized.filter(
    (ref): ref is ProspectSourceRef => ref !== null,
  );
  if (distinct.length > PROSPECT_SOURCE_REFS_MAX) {
    throw invalid(
      `${field} allows at most ${PROSPECT_SOURCE_REFS_MAX} distinct source references`,
    );
  }
  return distinct;
}

/** Bound one observed metric; `name` is always explicit (§4.1). */
export function assertObservedMetric(
  metric: Infer<typeof vObservedMetric>,
  field: string,
): Infer<typeof vObservedMetric> {
  if (!Number.isFinite(metric.value)) {
    throw invalid(`${field}.value must be a finite number`);
  }
  return {
    name: boundedString(metric.name, `${field}.name`, { min: 1, max: 100 }),
    value: metric.value,
    ...(metric.currency === undefined
      ? {}
      : {
          currency: boundedString(metric.currency, `${field}.currency`, {
            min: 3,
            max: 3,
          }).toUpperCase(),
        }),
    ...(metric.period === undefined ? {} : { period: metric.period }),
  };
}

/**
 * The provider's own assessment of the address it returned. Deliberately NOT
 * send eligibility: suppressions and sending policy decide
 * whether OpenSquad may write to an address (§4.3). `unknown` is the honest
 * value when the provider states nothing.
 */
export const vProviderEmailStatus = v.union(
  v.literal("verified"),
  v.literal("guessed"),
  v.literal("unavailable"),
  v.literal("unknown"),
);

export type ProviderEmailStatus =
  | "verified"
  | "guessed"
  | "unavailable"
  | "unknown";

export const CONTACT_SELECTION_REASON_MAX_LENGTH = 500;

/**
 * MVP `contact` — exactly one selected business person, not a list (§4.3).
 * `email` is absent unless the provider returned one; an address is never
 * manufactured, so absence plus a preserved `providerEmailStatus` is the
 * correct representation of "we could not get one".
 */
export const vProspectContact = v.object({
  source: vProspectSource,
  providerRef: v.string(),
  fullName: v.string(),
  role: v.optional(v.string()),
  email: v.optional(v.string()),
  providerEmailStatus: vProviderEmailStatus,
  retrievedAt: v.number(),
  selectionReason: v.string(),
});

export type ProspectContact = Infer<typeof vProspectContact>;

/** Bound and normalize a selected contact before storing it. */
export function assertProspectContact(
  contact: ProspectContact,
  field = "contact",
): ProspectContact {
  const email =
    contact.email === undefined
      ? undefined
      : normalizeEmailAddress(contact.email, `${field}.email`);
  if (email === undefined && contact.providerEmailStatus === "verified") {
    throw invalid(
      `${field}.providerEmailStatus cannot be "verified" without a provider-returned address`,
    );
  }
  if (email !== undefined && contact.providerEmailStatus === "unavailable") {
    throw invalid(
      `${field}.providerEmailStatus "unavailable" contradicts the supplied address`,
    );
  }
  return {
    source: contact.source,
    providerRef: boundedString(contact.providerRef, `${field}.providerRef`, {
      min: 1,
      max: PROVIDER_RECORD_ID_MAX_LENGTH,
    }),
    fullName: boundedString(contact.fullName, `${field}.fullName`, {
      min: 1,
      max: 200,
    }),
    ...(contact.role === undefined
      ? {}
      : {
          role: boundedString(contact.role, `${field}.role`, {
            min: 1,
            max: 200,
          }),
        }),
    ...(email === undefined ? {} : { email }),
    providerEmailStatus: contact.providerEmailStatus,
    retrievedAt: assertEpochMs(contact.retrievedAt, `${field}.retrievedAt`),
    selectionReason: boundedString(
      contact.selectionReason,
      `${field}.selectionReason`,
      { min: 1, max: CONTACT_SELECTION_REASON_MAX_LENGTH },
    ),
  };
}

/**
 * Next-action kinds. §4.3 requires "a bounded description plus action kind"
 * but enumerates no members, so this list is derived from the §5 CRM/booking
 * entry points and the §8 "CRM and booking transitions" rules. P19's picker
 * renders exactly these;
 * a new kind is a deliberate widening here, never a free-form string.
 */
export const NEXT_ACTION_KINDS = [
  "follow_up_email",
  "call",
  "await_reply",
  "research",
  "enrich_contact",
  "propose_booking",
  "confirm_booking",
  "attend_meeting",
  "review",
] as const;

export const vNextActionKind = v.union(
  v.literal("follow_up_email"),
  v.literal("call"),
  v.literal("await_reply"),
  v.literal("research"),
  v.literal("enrich_contact"),
  v.literal("propose_booking"),
  v.literal("confirm_booking"),
  v.literal("attend_meeting"),
  v.literal("review"),
);

export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export const NEXT_ACTION_DESCRIPTION_MAX_LENGTH = 500;

/**
 * `nextAction` is the work itself; `prospects.nextActionDueAt` is a separate
 * optional UTC epoch-ms field. An absent due time is the explicit
 * "unscheduled" state — never a far-future sentinel date (§4.3).
 */
export const vNextAction = v.object({
  kind: vNextActionKind,
  description: v.string(),
});

export type NextAction = Infer<typeof vNextAction>;

/** Bound a next action's free text before storing it. */
export function assertNextAction(
  action: NextAction,
  field = "nextAction",
): NextAction {
  return {
    kind: action.kind,
    description: boundedString(action.description, `${field}.description`, {
      min: 1,
      max: NEXT_ACTION_DESCRIPTION_MAX_LENGTH,
    }),
  };
}

/**
 * One candidate company a source produced, in the shape the pipeline importer
 * accepts. Deliberately NOT a prospect row: `canonicalDomain`, `qualification`,
 * `salesStage`, `ownerIdentityKey`, `version` and the timestamps are all
 * backend facts derived at import, so a caller cannot state them.
 *
 * `websiteUrl` rather than a bare domain, because provenance arrives as a URL
 * and `normalizeCanonicalDomain` extracts the host through the URL parser —
 * a path, query or credential can never leak into the dedupe key.
 */
export const vProspectCandidate = v.object({
  companyName: v.string(),
  websiteUrl: v.string(),
  sourceRefs: v.array(vProspectSourceRef),
  fitReason: v.optional(v.string()),
  contact: v.optional(vProspectContact),
});

export type ProspectCandidate = Infer<typeof vProspectCandidate>;

/** Bound on one import batch, so a single call cannot buy unbounded work
 *  inside the importing transaction. The campaign's own `leadLimit` (1..5) is
 *  what decides how many of them can actually become leads. */
export const PROSPECT_IMPORT_CANDIDATES_MAX = 50;

/* ----- lead events ----------------------------------------------------- */

/**
 * Append-only CRM history kinds (§4.3: status / owner / note / next-action /
 * booking history, plus the §8 research and enrichment updates). Unlike
 * `activityEvents.kind` — a bounded string feeding a receipts timeline — this
 * is a closed union, because a lead event is the audit record a human stage
 * correction and a booking transition are proved by.
 */
export const LEAD_EVENT_KINDS = [
  "stage_changed",
  "owner_assigned",
  "note_added",
  "next_action_set",
  "next_action_cleared",
  "research_applied",
  "contact_enriched",
  "send_accepted",
  "reply_received",
  "booking_proposed",
  "booking_confirmed",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_outcome_recorded",
] as const;

export const vLeadEventKind = v.union(
  v.literal("stage_changed"),
  v.literal("owner_assigned"),
  v.literal("note_added"),
  v.literal("next_action_set"),
  v.literal("next_action_cleared"),
  v.literal("research_applied"),
  v.literal("contact_enriched"),
  v.literal("send_accepted"),
  v.literal("reply_received"),
  v.literal("booking_proposed"),
  v.literal("booking_confirmed"),
  v.literal("booking_rescheduled"),
  v.literal("booking_cancelled"),
  v.literal("booking_outcome_recorded"),
);

export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];

/**
 * Who caused the event. A discriminated union rather than
 * `activityEvents.actor`'s bare string, because §4.3 makes the provenance
 * structural: only a `human` actor carries an `identityKey`, and it comes from
 * `ctx.auth` — never from model output or email content. `workflow` is the
 * internal pipeline; `system` is a backend sweep with no human behind it.
 */
export const vLeadEventActor = v.union(
  v.object({ source: v.literal("human"), identityKey: v.string() }),
  v.object({ source: v.literal("workflow") }),
  v.object({ source: v.literal("system") }),
);

export type LeadEventActor = Infer<typeof vLeadEventActor>;

export const LEAD_EVENT_SUMMARY_MAX_LENGTH = 500;
export const LEAD_EVENT_NOTE_MAX_LENGTH = 4_000;
export const LEAD_EVENT_REASON_MAX_LENGTH = 1_000;

/**
 * Structured previous/new values §8 "CRM and booking transitions" requires
 * an event to preserve. Every
 * member is optional because one event kind uses a few of them, but the shape
 * is closed — a lead event never carries an open bag of model-chosen keys.
 * `fromStage`/`toStage` are top-level columns and are deliberately absent here.
 */
export const vLeadEventDetails = v.object({
  fromOwnerIdentityKey: v.optional(v.string()),
  toOwnerIdentityKey: v.optional(v.string()),
  fromQualification: v.optional(vQualification),
  toQualification: v.optional(vQualification),
  fromNextAction: v.optional(vNextAction),
  toNextAction: v.optional(vNextAction),
  fromNextActionDueAt: v.optional(v.number()),
  toNextActionDueAt: v.optional(v.number()),
  previousStartsAt: v.optional(v.number()),
  previousEndsAt: v.optional(v.number()),
  previousTimezone: v.optional(v.string()),
  /** Stated basis for a human correction, cancellation or won/lost call. */
  reason: v.optional(v.string()),
  /** Body of a `note_added` event — a note, never a synthesized message. */
  note: v.optional(v.string()),
});

export type LeadEventDetails = Infer<typeof vLeadEventDetails>;

/* ----- bookings -------------------------------------------------------- */

export const vBookingState = v.union(
  v.literal("proposed"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("no_show"),
);

export type BookingState =
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

/** States that occupy the at-most-one-active slot per lead (§4.3). */
export const BOOKING_ACTIVE_STATES: readonly BookingState[] = [
  "proposed",
  "confirmed",
];

/** States that REQUIRE `startsAt`, `endsAt` and `timezone` (§4.3). */
export const BOOKING_TIMED_STATES: readonly BookingState[] = [
  "confirmed",
  "completed",
  "no_show",
];

/**
 * How a meeting time became authoritative. `manual` is an authenticated
 * human's assertion. `provider` keeps a typed contract but is UNAVAILABLE
 * until a validated calendar connector verifies the event — the same
 * declared-but-gated shape as `ENABLED_SOURCES`; no model may fabricate an
 * external event ID (§4.3, §8 "CRM and booking transitions").
 */
export const vConfirmationSource = v.union(
  v.literal("manual"),
  v.literal("provider"),
);

export type ConfirmationSource = "manual" | "provider";

/** Confirmation sources currently permitted on a write. */
export const ENABLED_CONFIRMATION_SOURCES = ["manual"] as const;

/**
 * Reject a confirmation basis whose verification path does not exist yet.
 * `provider` stays declared but unwritable until a validated calendar
 * connector can supply a real event — §4.3 forbids standing one in for a
 * human assertion, and §8 forbids fabricating external event IDs.
 */
export function assertConfirmationSourceEnabled(
  source: ConfirmationSource,
): void {
  const enabled = new Set<string>(ENABLED_CONFIRMATION_SOURCES);
  if (!enabled.has(source)) {
    throw invalid(
      `confirmationSource ${source} is not available; a validated calendar connector must verify the event first`,
    );
  }
}

export const BOOKING_SLOTS_MAX = 3;
export const BOOKING_CONFIRMATION_NOTE_MAX_LENGTH = 300;
export const BOOKING_CANCELLATION_REASON_MAX_LENGTH = 500;
/**
 * A confirmed meeting longer than this is not a sales call — it is a data
 * error the operator should fix before it is recorded.
 * `assertRequiredBookingTimes` enforces it alongside `endsAt > startsAt`
 * ("invalid duration", V24).
 */
export const BOOKING_DURATION_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * `bookings.proposal` (§4.3): a booking link, or up to three future intervals
 * under one IANA timezone. A proposal implies NO confirmation — neither a sent
 * link nor an offered slot nor a model classification confirms a meeting.
 */
export const vBookingProposal = v.union(
  v.object({ kind: v.literal("booking_link"), url: v.string() }),
  v.object({
    kind: v.literal("slots"),
    timezone: v.string(),
    slots: v.array(v.object({ startsAt: v.number(), endsAt: v.number() })),
  }),
);

export type BookingProposal = Infer<typeof vBookingProposal>;

/**
 * Validate a proposal at proposal time: a public http(s) link, or 1–3 valid
 * future intervals under a canonical IANA zone. Returns the normalized value.
 */
export function assertBookingProposal(
  proposal: BookingProposal,
  options: { now: number },
  field = "proposal",
): BookingProposal {
  if (proposal.kind === "booking_link") {
    return {
      kind: "booking_link",
      url: normalizeHttpUrl(proposal.url, `${field}.url`),
    };
  }
  if (proposal.slots.length === 0) {
    throw invalid(`${field}.slots must offer at least one interval`);
  }
  if (proposal.slots.length > BOOKING_SLOTS_MAX) {
    throw invalid(
      `${field}.slots allows at most ${BOOKING_SLOTS_MAX} intervals`,
    );
  }
  return {
    kind: "slots",
    timezone: assertIanaTimezone(proposal.timezone, `${field}.timezone`),
    slots: proposal.slots.map((slot, index) => {
      const at = `${field}.slots[${index}]`;
      const startsAt = assertEpochMs(slot.startsAt, `${at}.startsAt`);
      const endsAt = assertEpochMs(slot.endsAt, `${at}.endsAt`);
      if (endsAt <= startsAt) {
        throw invalid(`${at}.endsAt must be after startsAt`);
      }
      if (endsAt - startsAt > BOOKING_DURATION_MAX_MS) {
        throw invalid(
          `${at} duration exceeds ${BOOKING_DURATION_MAX_MS / 3_600_000} hours`,
        );
      }
      if (startsAt <= options.now) {
        throw invalid(`${at}.startsAt must be in the future`);
      }
      return { startsAt, endsAt };
    }),
  };
}

/**
 * Enforce the §4.3 precondition "times required for confirmed/completed/
 * no-show", returning the normalized triple for those states only.
 *
 * NOT a way to derive what to STORE. `undefined` here means "this state does
 * not require times", never "this row has none": a booking cancelled from
 * `confirmed` still carries the agreed start/end/timezone, and §8 "CRM and
 * booking transitions" requires keeping it — writing the triple back as
 * undefined on cancel would destroy the record of what was actually agreed.
 * The row-level timezone is the CONFIRMED meeting's zone; a `slots` proposal's
 * own timezone records what was offered and is not rewritten by a reschedule.
 */
export function assertRequiredBookingTimes(
  state: BookingState,
  times: { startsAt?: number; endsAt?: number; timezone?: string },
  field = "booking",
): { startsAt: number; endsAt: number; timezone: string } | undefined {
  if (!BOOKING_TIMED_STATES.includes(state)) {
    return undefined;
  }
  if (
    times.startsAt === undefined ||
    times.endsAt === undefined ||
    times.timezone === undefined
  ) {
    throw invalid(
      `${field} in state ${state} requires startsAt, endsAt and timezone`,
    );
  }
  const startsAt = assertEpochMs(times.startsAt, `${field}.startsAt`);
  const endsAt = assertEpochMs(times.endsAt, `${field}.endsAt`);
  if (endsAt <= startsAt) {
    throw invalid(`${field}.endsAt must be after startsAt`);
  }
  if (endsAt - startsAt > BOOKING_DURATION_MAX_MS) {
    throw invalid(
      `${field} duration exceeds ${BOOKING_DURATION_MAX_MS / 3_600_000} hours`,
    );
  }
  return {
    startsAt,
    endsAt,
    timezone: assertIanaTimezone(times.timezone, `${field}.timezone`),
  };
}

/* ----- evidence -------------------------------------------------------- */

/**
 * §4.3/§4.5 research confidence. `hypothesis` must be labeled rather than
 * asserted — an unlabeled guess stored as `supported` is the failure this
 * union exists to prevent.
 */
export const vEvidenceConfidence = v.union(
  v.literal("supported"),
  v.literal("hypothesis"),
  v.literal("unknown"),
);

export type EvidenceConfidence = "supported" | "hypothesis" | "unknown";

/** §4.5 research caps. */
export const EVIDENCE_EXCERPT_MAX_LENGTH = 2_000;
export const EVIDENCE_OBSERVATION_MAX_LENGTH = 1_000;
export const RESEARCH_OBSERVATIONS_MAX = 12;

/**
 * The reserved marker put in front of a topic when the finding is a guess
 * rather than something the page states. §4.5 requires "hypotheses labeled";
 * this is the label, and it is the ONLY way an observation can be stored as
 * `hypothesis`.
 *
 * Matched case-insensitively on the trimmed topic. Nothing else about the
 * model's wording contributes to `confidence` — see `evidence.ts`.
 */
export const EVIDENCE_HYPOTHESIS_MARKER = "hypothesis:";

/**
 * How many observations one research result may hand the synthesis site
 * before the payload itself is refused. Distinct from
 * `RESEARCH_OBSERVATIONS_MAX`, which bounds how many become evidence ROWS:
 * a chatty model must not fail the whole research result, so the overflow is
 * reported as rejected rather than thrown, and only a payload past this bound
 * (which would buy unbounded work inside the caller's transaction) is refused.
 */
export const RESEARCH_OBSERVATION_INPUT_MAX = 50;

/**
 * One reported observation. `sourceUrl` stays optional: an observation
 * without one is not evidence (§4.5), which is a rule about what gets STORED,
 * not about what may be reported.
 */
export const vResearchObservation = v.object({
  topic: v.string(),
  finding: v.string(),
  sourceUrl: v.optional(v.string()),
});

export type ResearchObservation = Infer<typeof vResearchObservation>;

export const EVIDENCE_TOPIC_MAX_LENGTH = 200;

/**
 * Bound one stored `evidence.observation`. The first caller of
 * `EVIDENCE_OBSERVATION_MAX_LENGTH`, which P20 declared with no enforcement.
 * The topic is carried into the observation rather than dropped, so a stored
 * row still says what the finding is ABOUT; the hypothesis marker is stripped
 * because it is a host control token, not part of the observation's text.
 */
export function assertEvidenceObservation(
  topic: string,
  finding: string,
  field = "observation",
): string {
  const bare = stripHypothesisMarker(topic);
  const boundedTopic = boundedString(bare, `${field}.topic`, {
    min: 1,
    max: EVIDENCE_TOPIC_MAX_LENGTH,
  });
  const boundedFinding = boundedString(finding, `${field}.finding`, {
    min: 1,
    max: EVIDENCE_OBSERVATION_MAX_LENGTH,
  });
  return boundedString(`${boundedTopic}: ${boundedFinding}`, field, {
    min: 1,
    max: EVIDENCE_OBSERVATION_MAX_LENGTH,
  });
}

/** True when the model labelled this observation a hypothesis (§4.5). */
export function isHypothesisTopic(topic: string): boolean {
  return topic.trimStart().toLowerCase().startsWith(EVIDENCE_HYPOTHESIS_MARKER);
}

/** The topic with the host's hypothesis marker removed. */
export function stripHypothesisMarker(topic: string): string {
  const trimmed = topic.trim();
  return isHypothesisTopic(trimmed)
    ? trimmed.slice(EVIDENCE_HYPOTHESIS_MARKER.length).trim()
    : trimmed;
}

/**
 * Bound one stored `evidence.excerpt` — a span of the page the BACKEND
 * retrieved, re-sliced from the Firecrawl wrapper's 4,000-char excerpt down
 * to `EVIDENCE_EXCERPT_MAX_LENGTH`. Writing `markdownExcerpt` straight
 * through is out of bounds (§4.5), and so is storing an empty excerpt: a page
 * that yielded no text is a page there is nothing to cite, which must surface
 * as a rejected observation rather than as evidence with nothing behind it.
 */
export function assertEvidenceExcerpt(
  pageExcerpt: string,
  field = "excerpt",
): string {
  return boundedString(pageExcerpt.slice(0, EVIDENCE_EXCERPT_MAX_LENGTH), field, {
    min: 1,
    max: EVIDENCE_EXCERPT_MAX_LENGTH,
  });
}

/**
 * Optimistic-concurrency check for a versioned row. Takes the numbers rather
 * than a document, so every versioned table shares one form.
 */
export function assertExpectedVersion(
  current: number,
  expected: number,
  label: string,
): void {
  if (current !== expected) {
    throw domainError(
      "CONFLICT",
      `${label} version is ${current}, not ${expected}`,
    );
  }
}
