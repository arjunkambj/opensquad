/**
 * Cross-domain validator primitives: bounded strings and numbers,
 * URL/timezone/email normalisation, content digests and the local-time
 * helpers every domain shares.
 *
 * Convex `v.*` validators describe wire/storage shape; they cannot express
 * length or syntax rules, so every `v.string()` that carries a bound is paired
 * with a runtime check here. Call the `assert*`/`normalize*` helpers inside
 * handlers before trusting or storing a value.
 */
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { domainError, invalid } from "../errors";

// The error vocabulary itself lives in `lib/errors.ts` (PLAN §10): one typed
// code union and one constructor, so the client maps a code to copy in a
// single place. It is re-exported here because every backend module reaches
// its validators — and its refusals — through `lib/validators`.
export { domainError, invalid, DOMAIN_ERROR_CODES } from "../errors";
export type { DomainErrorCode, DomainErrorData } from "../errors";

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
