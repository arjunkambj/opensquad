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
/* Agents (PLAN §7) — the one sales agent a workspace runs              */
/* ------------------------------------------------------------------ */

/**
 * How much the agent may do on its own (PLAN §1, §9.3). `sourcing_only` is
 * the default until an inbox is connected: it finds and researches leads and
 * contacts nobody. Autopilot is never entered by a migration or a reconnect —
 * only by the consent dialog that writes `agents.autopilot`.
 */
export const AGENT_MODES = [
  "sourcing_only",
  "review",
  "autopilot",
  "paused",
] as const;

export const vAgentMode = v.union(
  v.literal("sourcing_only"),
  v.literal("review"),
  v.literal("autopilot"),
  v.literal("paused"),
);

export type AgentMode = (typeof AGENT_MODES)[number];

/** Modes in which the agent may put mail on the wire at all (PLAN §9.3). */
export const SENDING_AGENT_MODES: readonly AgentMode[] = [
  "review",
  "autopilot",
];

/**
 * `draft` while onboarding is still filling the agent in; `live` from the
 * moment "Confirm & find leads" is pressed. The run cron selects live agents
 * whose `nextRunAt` is due — nothing else starts a run (EXECUTION "API
 * hand-offs": T23 flips the flag, T30 reads it).
 */
export const vAgentStatus = v.union(v.literal("draft"), v.literal("live"));

export type AgentStatus = "draft" | "live";

/**
 * Where the onboarding stepper resumes (PLAN §5 "Progress is saved per step",
 * §11 M1). One member per dot **and** per sub-step, because the reference
 * splits dots 2–4 into sub-screens and a refresh must land on the sub-screen
 * the user left — a bare dot number cannot express that. `done` is the
 * finished state the `/onboarding` guard redirects away from.
 */
export const ONBOARDING_STEPS = [
  "company",
  "icp_job_titles",
  "icp_company_filters",
  "icp_exclusions",
  "outreach_inbox",
  "outreach_goals",
  "signals_strategies",
  "signals_keywords",
  "signals_review",
  "done",
] as const;

export const vOnboardingStep = v.union(
  v.literal("company"),
  v.literal("icp_job_titles"),
  v.literal("icp_company_filters"),
  v.literal("icp_exclusions"),
  v.literal("outreach_inbox"),
  v.literal("outreach_goals"),
  v.literal("signals_strategies"),
  v.literal("signals_keywords"),
  v.literal("signals_review"),
  v.literal("done"),
);

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What the outreach is for (PLAN §7, reference 05). */
export const vAgentGoal = v.union(
  v.literal("start_conversations"),
  v.literal("book_calls"),
);

export type AgentGoal = "start_conversations" | "book_calls";

/** How the outreach reads (PLAN §7, reference 05). */
export const vAgentTone = v.union(
  v.literal("professional"),
  v.literal("conversational"),
  v.literal("direct"),
);

export type AgentTone = "professional" | "conversational" | "direct";

/**
 * The ideal customer profile the strategies are built from (PLAN §7). Every
 * member is a list so an empty ICP is a valid draft state — onboarding fills
 * them one sub-step at a time and `onboardingStep` says how far it got.
 * Values are the provider's own allowed strings, re-checked against the
 * cached `leadFilterOptions` before any search (PLAN §3 step 2).
 */
export const vAgentIcp = v.object({
  jobTitles: v.array(v.string()),
  industries: v.array(v.string()),
  locations: v.array(v.string()),
  companyTypes: v.array(v.string()),
  companySizes: v.array(v.string()),
  excludeProfiles: v.array(v.string()),
  excludeKeywords: v.array(v.string()),
});

export type AgentIcp = Infer<typeof vAgentIcp>;

/** An ICP with every list empty — the shape a draft agent starts from. */
export const EMPTY_AGENT_ICP: AgentIcp = {
  jobTitles: [],
  industries: [],
  locations: [],
  companyTypes: [],
  companySizes: [],
  excludeProfiles: [],
  excludeKeywords: [],
};

/**
 * The single-flight lease a run holds (PLAN §9.1). A second trigger is a
 * no-op while `leaseUntil` is in the future, and every step re-checks it
 * still holds `leaseId` before writing.
 */
export const vAgentRun = v.object({
  leaseId: v.string(),
  leaseUntil: v.number(),
  startedAt: v.number(),
});

export type AgentRun = Infer<typeof vAgentRun>;

/**
 * Recorded Autopilot consent (PLAN §9.3). The `revision` is the agent
 * revision the user consented under, so a later instruction change is
 * visible as "consented under an older revision" rather than silently
 * re-authorised.
 */
export const vAgentAutopilot = v.object({
  authorizedBy: v.string(),
  authorizedAt: v.number(),
  revision: v.number(),
});

export type AgentAutopilot = Infer<typeof vAgentAutopilot>;

export const AGENT_NAME_MAX_LENGTH = 120;
export const AGENT_INSTRUCTIONS_MAX_LENGTH = 8_000;
export const AGENT_KEYWORDS_MAX = 25;
export const AGENT_KEYWORD_MAX_LENGTH = 100;
export const ICP_LIST_MAX_ITEMS = 50;
export const ICP_VALUE_MAX_LENGTH = 200;
export const AGENT_FOLLOW_UP_DAYS_MAX = 4;

/** Defaults from PLAN §9.2/§9.3; retuned in `lib/limits.ts` (T02). */
export const AGENT_DAILY_LEAD_CAP_DEFAULT = 25;
export const AGENT_DAILY_RESEARCH_CAP_DEFAULT = 5;
export const AGENT_AUTO_REVEAL_DAILY_CAP_DEFAULT = 5;
export const AGENT_AUTO_APPROVE_MIN_SCORE_DEFAULT = 2;
export const AGENT_FOLLOW_UP_DAYS_DEFAULT: readonly number[] = [3, 7];

/* ------------------------------------------------------------------ */
/* Search strategies (PLAN §3)                                          */
/* ------------------------------------------------------------------ */

/**
 * The signal a strategy is built on. Exactly the catalogue of PLAN §3 —
 * only signals the lead-data API can actually answer are offered, and
 * `core_icp` is always present.
 */
export const SIGNAL_KINDS = [
  "core_icp",
  "funded",
  "hiring",
  "growth",
  "ad_spend",
  "tech",
  "team_shape",
  "keyword",
] as const;

export const vSignalKind = v.union(
  v.literal("core_icp"),
  v.literal("funded"),
  v.literal("hiring"),
  v.literal("growth"),
  v.literal("ad_spend"),
  v.literal("tech"),
  v.literal("team_shape"),
  v.literal("keyword"),
);

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Who put the strategy there (PLAN §7). */
export const vStrategySource = v.union(
  v.literal("recommended"),
  v.literal("user"),
);

export type StrategySource = "recommended" | "user";

/**
 * One stored lead-search filter value. The provider's filter set is ~139
 * fields of scalars and string lists (spikes §3), so the stored shape is a
 * bounded record rather than 139 columns. It is NOT a free-form bag: the
 * filter builder (T11) accepts a key only when the cached
 * `leadFilterOptions` declares it, and an enum value only when that filter's
 * `values` contains it — a typo silently returns zero rows otherwise.
 */
export const vLeadFilterValue = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
);

export const vLeadFilters = v.record(v.string(), vLeadFilterValue);

export type LeadFilters = Infer<typeof vLeadFilters>;

/** One cached allowed-value set, as the provider's filter catalogue states it. */
export const vLeadFilterOption = v.object({
  label: v.string(),
  category: v.union(
    v.literal("person"),
    v.literal("organization"),
    v.literal("insights"),
  ),
  /** Empty for the free-text filters (spikes §3) — not a failed fetch. */
  values: v.array(v.string()),
  maxSelections: v.number(),
});

export type LeadFilterOption = Infer<typeof vLeadFilterOption>;

export const STRATEGY_TITLE_MAX_LENGTH = 120;
export const STRATEGY_RATIONALE_MAX_LENGTH = 400;

/* ------------------------------------------------------------------ */
/* Providers, digests and reply dispositions                           */
/* ------------------------------------------------------------------ */

/**
 * Paid or metered backends the app records `providerOperations` and
 * `platformBudgets` against. These names are SERVER-SIDE ONLY: no query that
 * feeds the client may return one (PLAN §4 "White-label rule").
 */
export const PROVIDER_KINDS = [
  "firecrawl",
  "agentmail",
  "enrich",
  "ai_gateway",
] as const;
export const vProviderKind = v.union(
  v.literal("firecrawl"),
  v.literal("agentmail"),
  v.literal("enrich"),
  v.literal("ai_gateway"),
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
 * How a message reached us (PLAN §7, §9.4). Webhooks only deliver new mail,
 * so connecting an inbox schedules a 30-day thread import marked `backfill`.
 *
 * The distinction is a safety gate, not a label: `handleReply` runs only on
 * `live` mail that arrived after `workspaces.connectedAt` — backfilled
 * history is readable in the Inbox and nothing more ("Never answer history").
 * When both paths race on the same provider message, `live` WINS and a later
 * backfill never downgrades it.
 */
export const vMessageSource = v.union(
  v.literal("backfill"),
  v.literal("live"),
);

export type MessageSource = "backfill" | "live";

/**
 * Which source survives when backfill and the live webhook write the same
 * provider message (PLAN §9.4). Defined once so the single-writer upsert and
 * the conversation-level stamp cannot disagree.
 */
export function mergeMessageSource(
  stored: MessageSource | undefined,
  incoming: MessageSource,
): MessageSource {
  return stored === "live" || incoming === "live" ? "live" : "backfill";
}

/**
 * Draft lifecycle (PLAN §7 "drafts: agentRevision, state superseded").
 * A revision is immutable, so `superseded` means "no longer the draft to
 * send" — written when the agent's revision moves on, the lead is rejected
 * or a reply lands (PLAN §9.1 "Invalidate on change").
 *
 * INVARIANT: `state === "superseded"` exactly when `supersededAt` is set;
 * both are written in the same patch.
 */
export const vDraftState = v.union(
  v.literal("current"),
  v.literal("superseded"),
);

export type DraftState = "current" | "superseded";

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

/**
 * The metered quantities (PLAN §6 "Ledger"). `credits` is the one number the
 * user sees; the rest are the hidden provider caps in the provider's own
 * units, which is why a call must pass both layers. Period keys are
 * `USAGE_PERIOD_LIFETIME` or the workspace-local day (`localDayKey`).
 */
export const USAGE_METRICS = [
  "credits",
  "enrich_credits",
  "enrich_searches",
  "ai_calls",
  "scrapes",
  "sends",
] as const;

export const vUsageMetric = v.union(
  v.literal("credits"),
  v.literal("enrich_credits"),
  v.literal("enrich_searches"),
  v.literal("ai_calls"),
  v.literal("scrapes"),
  v.literal("sends"),
);

export type UsageMetric = (typeof USAGE_METRICS)[number];

/** The non-daily period key: a bucket that never rolls over. */
export const USAGE_PERIOD_LIFETIME = "lifetime";

/** The one scope key a workspace-wide bucket uses. */
export const USAGE_SCOPE_WORKSPACE = "workspace";

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
 * Lead research reads the lead's company home page and nothing else
 * (PLAN §4 "Firecrawl change needed": website analysis takes up to four
 * pages, lead research stays at one). Three is the per-lead ceiling on
 * BILLED retrievals, so a retried research step cannot buy a fourth page.
 */
export const RESEARCH_PAGES_PER_PROSPECT = 3;

/**
 * The workspace's lifetime scrape allowance — PLAN §6 layer 2, "Firecrawl
 * pages: 80 lifetime". Provisional home: it moves to `convex/lib/limits.ts`
 * with the rest of the price/cap map in T02, which is also what grants the
 * bucket at workspace creation.
 */
export const TRIAL_SCRAPES_LIFETIME_LIMIT = 80;

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
/* Leads (PLAN §7) — the person-level lead the agent works              */
/*                                                                     */
/* Contract only: these validators and bounds are the single           */
/* definition the agent run, the contacts surface, the outreach loop    */
/* and the inbox import. Widening a union here is a deliberate edit at  */
/* one site — no module may re-declare a parallel vocabulary.          */
/* ------------------------------------------------------------------ */

/**
 * Mapped failure codes. Provider wording NEVER leaves `integrations/` or
 * `ai/` (PLAN §4 white-label rule, §10 "Errors"), so everything that stores
 * or shows a failure stores one of these and the client maps it to copy.
 */
export const OPERATION_ERROR_CODES = [
  "rate_limited",
  "provider_unavailable",
  "unreadable_source",
  "not_found",
  "invalid_response",
  "insufficient_credits",
  "platform_paused",
  "timeout",
  "unknown",
] as const;

export const vOperationErrorCode = v.union(
  v.literal("rate_limited"),
  v.literal("provider_unavailable"),
  v.literal("unreadable_source"),
  v.literal("not_found"),
  v.literal("invalid_response"),
  v.literal("insufficient_credits"),
  v.literal("platform_paused"),
  v.literal("timeout"),
  v.literal("unknown"),
);

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

/**
 * The failure a step records on the row it was working (PLAN §9.1 "Retries").
 * `attempts` is what drives the retry ladder and the hand-off to
 * `needs_attention`, so it is part of the stored fact, not a log line.
 */
export const vOperationError = v.object({
  code: vOperationErrorCode,
  at: v.number(),
  attempts: v.number(),
});

export type OperationError = Infer<typeof vOperationError>;

/**
 * The lead pipeline (PLAN §7). `stage` plus `nextActionAt` IS the state
 * machine — the cron picks up whatever is due, so nothing else encodes
 * progress.
 *
 * Order is load-bearing: an automatic transition may only move a lead
 * forward (`advancedLeadStage`). The three stages outside the ordered
 * pipeline are deliberate:
 *   `rejected`      — the user said no; only a user re-approval leaves it.
 *   `closed_lost`   — the conversation ended; a human call.
 *   `needs_attention` — a step failed its retry ladder and parked the lead
 *                     with a Retry button (PLAN §9.1).
 */
export const LEAD_PIPELINE_STAGES = [
  "found",
  "researched",
  "queued",
  "contacted",
  "replied",
  "interested",
  "meeting_proposed",
  "meeting_booked",
] as const;

export const LEAD_STAGES = [
  ...LEAD_PIPELINE_STAGES,
  "closed_lost",
  "rejected",
  "needs_attention",
] as const;

export const vLeadStage = v.union(
  v.literal("found"),
  v.literal("researched"),
  v.literal("queued"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("interested"),
  v.literal("meeting_proposed"),
  v.literal("meeting_booked"),
  v.literal("closed_lost"),
  v.literal("rejected"),
  v.literal("needs_attention"),
);

export type LeadStage = (typeof LEAD_STAGES)[number];
export type LeadPipelineStage = (typeof LEAD_PIPELINE_STAGES)[number];

/** Stages an automatic transition never enters or leaves. */
export const TERMINAL_LEAD_STAGES: readonly LeadStage[] = [
  "closed_lost",
  "rejected",
];

/** Position in the ordered pipeline, or `-1` for a stage outside it. */
export function leadStageRank(stage: LeadStage): number {
  return (LEAD_PIPELINE_STAGES as readonly string[]).indexOf(stage);
}

/**
 * The stage an AUTOMATIC transition may land on, or the current one.
 *
 * Returning the current stage rather than throwing is deliberate: a step that
 * re-runs on an already-contacted lead should record its finding, not fail.
 * A lead parked in `needs_attention` is not silently un-parked either — only
 * an explicit retry moves it, which is what makes the Retry button honest.
 * Human corrections do not come through here.
 */
export function advancedLeadStage(
  current: LeadStage,
  target: LeadPipelineStage,
): LeadStage {
  if (TERMINAL_LEAD_STAGES.includes(current)) return current;
  if (current === "needs_attention") return current;
  return leadStageRank(target) > leadStageRank(current) ? target : current;
}

/**
 * Whether we have the lead's address (PLAN §7). `locked` is the honest
 * starting state: a sourced row carries no address at all until the user
 * spends the credits to find it, and `not_found` records that we paid and
 * the provider had none — never an invented address.
 */
export const vLeadEmailStatus = v.union(
  v.literal("locked"),
  v.literal("revealing"),
  v.literal("found"),
  v.literal("not_found"),
);

export type LeadEmailStatus = "locked" | "revealing" | "found" | "not_found";

/**
 * Lead approval — "yes, contact this person" (PLAN §9.3). Deliberately NOT
 * email approval, which is a verdict on one draft and lives in `approvals`.
 */
export const vLeadApproval = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export type LeadApproval = "pending" | "approved" | "rejected";

/**
 * Who approved. Autopilot approving is a recorded fact, not an absence of
 * one: PLAN §9.3 requires the same ledger either way, so the actor is stored
 * rather than inferred from the agent's mode at read time.
 */
export const vApprovalActor = v.union(
  v.literal("user"),
  v.literal("autopilot"),
);

export type ApprovalActor = "user" | "autopilot";

/**
 * Where the lead came from (PLAN §7, MIGRATION "Final-schema variants").
 *
 * A discriminated union rather than optional columns: a provider id exists
 * only on a sourced lead, and a folded-in pre-pivot campaign only on a
 * migrated one, so "found by a strategy" and "inherited from a campaign" are
 * different documents rather than the same document with different holes.
 * Dedupe on `sourceLeadId` therefore applies to `kind: "sourced"` alone.
 */
export const vLeadOrigin = v.union(
  v.object({
    kind: v.literal("sourced"),
    /** The lead-data provider's own row id. Neutral name by the white-label
     *  rule — no query that feeds the client returns it. */
    sourceLeadId: v.string(),
    /** Every strategy that matched this person; the "+n signals" badge and
     *  the multi-signal score boost both read it (PLAN §3). */
    strategyIds: v.array(v.id("strategies")),
  }),
  v.object({
    kind: v.literal("legacy"),
    legacyCampaignId: v.id("legacyCampaigns"),
  }),
  v.object({ kind: v.literal("manual") }),
);

export type LeadOrigin = Infer<typeof vLeadOrigin>;

/**
 * What research knows (PLAN §7). A score exists ONLY on a researched lead,
 * so found-but-unresearched and migrated leads are valid documents rather
 * than exceptions. UI and queries switch on the variant; nothing reads a
 * bare `aiScore`.
 */
export const vLeadResearch = v.union(
  v.object({ status: v.literal("not_researched") }),
  v.object({ status: v.literal("researching"), startedAt: v.number() }),
  v.object({
    status: v.literal("researched"),
    aiScore: v.union(v.literal(1), v.literal(2), v.literal(3)),
    aiScoreReason: v.string(),
    summary: v.string(),
    researchedAt: v.number(),
  }),
  v.object({ status: v.literal("failed"), lastError: vOperationError }),
);

export type LeadResearch = Infer<typeof vLeadResearch>;

/** The 1–3 flame score, defined once so no call site re-derives the range. */
export const LEAD_SCORE_MIN = 1;
export const LEAD_SCORE_MAX = 3;

/**
 * The denormalised value behind `prospects.by_workspaceId_and_scoreKey`.
 *
 * Convex indexes a top-level field, and `aiScore` lives inside a union
 * member, so the sortable score is stored beside `research` as `scoreKey`.
 * THE INVARIANT: `scoreKey` is written in the SAME patch as `research` and
 * by nothing else — pass the new `research` value through this function and
 * store both. It is an index key, never the score: readers switch on
 * `research.status === "researched"`.
 */
export function leadScoreKey(research: LeadResearch): number | undefined {
  return research.status === "researched" ? research.aiScore : undefined;
}

/**
 * The denormalised value behind `prospects.by_agentId_and_sourceLeadKey`,
 * under the same rule as `leadScoreKey`: written in the same patch as
 * `origin`, by nothing else, and read only as a dedupe lookup key. The
 * sourcing upsert reads this index to decide insert-or-merge (PLAN §3 step 5).
 */
export function leadSourceKey(origin: LeadOrigin): string | undefined {
  return origin.kind === "sourced" ? origin.sourceLeadId : undefined;
}

/**
 * A lead's company, as the free search preview describes it (spikes §3).
 * Stored under our own names — never the provider's — and every member is
 * optional because the preview row nulls all of them.
 */
export const vLeadCompany = v.object({
  linkedinUrl: v.optional(v.string()),
  logoUrl: v.optional(v.string()),
  headline: v.optional(v.string()),
  industry: v.optional(v.string()),
  employeeCount: v.optional(v.number()),
  employeeGrowthRate: v.optional(v.number()),
  revenueBucket: v.optional(v.string()),
  foundedYear: v.optional(v.string()),
  monthlyTraffic: v.optional(v.number()),
  totalFunding: v.optional(v.number()),
  lastFundingType: v.optional(v.string()),
  lastFundingDate: v.optional(v.string()),
  specialties: v.optional(v.string()),
  headquarters: v.optional(
    v.object({
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      country: v.optional(v.string()),
    }),
  ),
});

export type LeadCompany = Infer<typeof vLeadCompany>;

/** Where the person is, as the preview row states it. */
export const vLeadLocation = v.object({
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
});

export type LeadLocation = Infer<typeof vLeadLocation>;

/**
 * What a migration copied off a lead before the final schema dropped it
 * (MIGRATION §5: a forward step keeps a `legacy` copy until the rollback
 * window closes). Closed shape — never an open bag of pre-pivot keys — and
 * absent on every lead this application creates.
 */
export const vLeadLegacy = v.object({
  migratedAt: v.number(),
  salesStage: v.optional(v.string()),
  qualification: v.optional(v.string()),
  fitReason: v.optional(v.string()),
  ownerIdentityKey: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  sourceRefCount: v.optional(v.number()),
});

export type LeadLegacy = Infer<typeof vLeadLegacy>;

export const PROSPECT_COMPANY_NAME_MAX_LENGTH = 200;
export const PROSPECT_STAGE_REASON_MAX_LENGTH = 500;
export const PROVIDER_RECORD_ID_MAX_LENGTH = 200;
export const CANONICAL_DOMAIN_MAX_LENGTH = 253;
export const LEAD_PERSON_NAME_MAX_LENGTH = 200;
export const LEAD_HEADLINE_MAX_LENGTH = 500;
export const LEAD_SUMMARY_MAX_LENGTH = 4_000;
export const LEAD_SCORE_REASON_MAX_LENGTH = 1_000;
export const LEAD_SKILLS_MAX = 25;

/**
 * Canonical company domain for research and dedupe. Accepts a bare host or an
 * http(s) URL and extracts the host through the URL parser (so a path, query
 * or credentials cannot leak into the key), lowercases, drops a trailing root
 * dot and drops a leading `www.` — the one subdomain that never identifies a
 * different business. Every OTHER subdomain is preserved.
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

/* ----- business profile (PLAN §7) --------------------------------------- */

/**
 * Website analysis state (PLAN §5 "Onboarding edge cases"). The failure
 * variant carries a MAPPED code, never provider text: the screen says "We
 * couldn't read that website" and offers Retry / Fill in manually.
 * `firstRunUsed` is what makes the free first run free only on success.
 */
export const vAnalysisStatus = v.union(
  v.object({ state: v.literal("idle") }),
  v.object({ state: v.literal("analyzing"), startedAt: v.number() }),
  v.object({ state: v.literal("ready"), analyzedAt: v.number() }),
  v.object({
    state: v.literal("failed"),
    code: vOperationErrorCode,
    at: v.number(),
  }),
);

export type AnalysisStatus = Infer<typeof vAnalysisStatus>;

export const COMPANY_NAME_MAX_LENGTH = 200;
export const COMPANY_DESCRIPTION_MAX_LENGTH = 4_000;
export const COMPANY_PAIN_POINTS_MAX_LENGTH = 2_000;
export const COMPANY_LIST_MAX_ITEMS = 12;
export const COMPANY_LIST_ITEM_MAX_LENGTH = 300;

/* ----- workspace plan, inbox connection and secrets (PLAN §4, §6) ------- */

/**
 * One plan, no upgrade path, no billing UI (PLAN §6). It is stored rather
 * than assumed so the limit lookup can become a real plan map later without
 * touching a call site.
 */
export const vWorkspacePlan = v.literal("trial");

export type WorkspacePlan = "trial";

/**
 * How the workspace's sending inbox is attached (PLAN §4, §9.4).
 * `legacy_platform_inbox` is a workspace created before the pivot that still
 * receives on the platform account: readable in the Inbox, never
 * auto-answered, and unable to send until its owner connects their own key.
 */
export const vInboxConnection = v.union(
  v.literal("none"),
  v.literal("legacy_platform_inbox"),
  v.literal("connected"),
  v.literal("invalid"),
);

export type InboxConnection =
  | "none"
  | "legacy_platform_inbox"
  | "connected"
  | "invalid";

/** The two secrets a connected workspace holds (PLAN §4 "Bring-your-own keys"). */
export const vSecretProvider = v.union(
  v.literal("agentmail"),
  v.literal("agentmail_webhook"),
);

export type SecretProvider = "agentmail" | "agentmail_webhook";

/** What the last verification of that secret concluded. */
export const vSecretStatus = v.union(
  v.literal("unverified"),
  v.literal("valid"),
  v.literal("invalid"),
);

export type SecretStatus = "unverified" | "valid" | "invalid";

/** Length of the opaque per-workspace webhook path token. */
export const WEBHOOK_TOKEN_LENGTH = 32;

/* ----- lead events ----------------------------------------------------- */

/**
 * Append-only lead history kinds. Unlike `activityEvents.kind` — a bounded
 * string feeding a workspace receipts timeline — this is a closed union,
 * because a lead event is the audit record a stage change, an approval and a
 * booking transition are proved by.
 */
export const LEAD_EVENT_KINDS = [
  "stage_changed",
  "note_added",
  "research_applied",
  "email_revealed",
  "approval_changed",
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
  v.literal("note_added"),
  v.literal("research_applied"),
  v.literal("email_revealed"),
  v.literal("approval_changed"),
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
 * `activityEvents.actor`'s bare string, because the provenance is
 * structural: only a `human` actor carries an `identityKey`, and it comes from
 * `ctx.auth` — never from model output or email content. `workflow` is the
 * agent run; `system` is a backend sweep with no human behind it.
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
 * Structured previous/new values an event preserves. Every member is
 * optional because one event kind uses a few of them, but the shape is
 * closed — a lead event never carries an open bag of model-chosen keys.
 * `fromStage`/`toStage` are top-level columns and are deliberately absent here.
 */
export const vLeadEventDetails = v.object({
  fromApproval: v.optional(vLeadApproval),
  toApproval: v.optional(vLeadApproval),
  /** Who approved — `autopilot` is a recorded actor, not a missing one. */
  approvalActor: v.optional(vApprovalActor),
  fromEmailStatus: v.optional(vLeadEmailStatus),
  toEmailStatus: v.optional(vLeadEmailStatus),
  /** The 1-3 score a `research_applied` event concluded. */
  aiScore: v.optional(v.number()),
  previousStartsAt: v.optional(v.number()),
  previousEndsAt: v.optional(v.number()),
  previousTimezone: v.optional(v.string()),
  /** Stated basis for a human correction, a cancellation or a rejection. */
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
