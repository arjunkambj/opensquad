/**
 * The FREE half of reply handling: rules over text, run before any model and
 * never blocked by money (EXECUTION T41, PLAN §9.4).
 *
 * WHY THIS FILE EXISTS AT ALL. An unsubscribe request and a hard bounce are
 * the two replies whose handling must not depend on the account having credit,
 * on a per-workspace cap, on a platform budget or on the kill switch. A
 * workspace at zero credits with `PLATFORM_PAUSED=true` still has to stop
 * mailing someone who asked it to stop. So the detection is deterministic,
 * it lives in pure functions with no `ctx` at all, and the caller runs it to
 * completion BEFORE the first line that could reach `withCredits`. Nothing in
 * this module can spend anything, which is the only way to make that
 * guarantee readable rather than promised.
 *
 * WHAT IT MAY CONCLUDE, AND WHAT IT MAY NOT. A rule says "this message is an
 * unsubscribe / a bounce / an automatic answer". It never says WHO to
 * suppress: the address is always one the application resolved (the lead's
 * contact, or the address the last revision was authorized against), exactly
 * as `inboundApply.enforceOptOut` already requires. A message can name a
 * rule; it can never name its own suppression target.
 *
 * ERRING IS DIRECTIONAL. `unsubscribe` reuses the ONE canonical opt-out rule
 * in `lib/validators/inbox.ts` rather than a second vocabulary; a bounce needs
 * BOTH a daemon-shaped sender (or a failure header) AND a permanent-failure
 * phrase, because a lead writing "your last email was undeliverable" must not
 * suppress themselves; and an automatic answer only stops automation, so a
 * false positive there costs one un-answered reply that a person still sees
 * in the Inbox.
 */
import {
  evaluateOptOutText,
  INBOUND_BODY_SCAN_MAX_LENGTH,
  parseInboundSender,
  stripQuotedReply,
  THREAD_BODY_MAX_LENGTH,
} from "../lib/validators";
import type { OptOutSignal } from "../lib/validators";

/* ------------------------------------------------------------------ */
/* Reading one stored message                                          */
/* ------------------------------------------------------------------ */

/**
 * The bounded projection of one inbound message these rules read.
 *
 * Every field is derived from provider data, so every read is defensive: the
 * component stores the provider's own object under `raw` and types it
 * `v.any()`, and a missing or malformed field degrades this message rather
 * than failing the step.
 */
export type InboundMessageText = {
  subject?: string;
  /** The reply's own words: `extracted_text` when the provider extracted it,
   *  otherwise the plain text with quoted history cut off. */
  body: string;
  /** Normalized sender, when the header named exactly one address. */
  fromAddress?: string;
  /** Lower-cased header names, when the stored message carried any. */
  headers: Record<string, string>;
};

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Headers as the provider stored them, lower-cased and bounded. `raw` is the
 *  provider's own message object, so nothing here assumes a shape. */
function readHeaders(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const candidate = (raw as Record<string, unknown>).headers;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    candidate as Record<string, unknown>,
  )) {
    if (typeof value !== "string") {
      continue;
    }
    headers[name.toLowerCase()] = value.slice(0, 500).toLowerCase();
  }
  return headers;
}

/** One stored inbound row, projected to what the rules and the prompt read. */
export function readInboundMessageText(row: unknown): InboundMessageText {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return { body: "", headers: {} };
  }
  const source = row as Record<string, unknown>;
  const extracted = readString(source, "extractedText");
  const text = readString(source, "text");
  const body =
    extracted ??
    (text === undefined ? (readString(source, "preview") ?? "") : stripQuotedReply(text));
  const subject = readString(source, "subject");
  const fromAddress = parseInboundSender(source.from);
  return {
    body: body.slice(0, THREAD_BODY_MAX_LENGTH),
    headers: readHeaders(source.raw),
    ...(subject === undefined ? {} : { subject }),
    ...(fromAddress === undefined ? {} : { fromAddress }),
  };
}

/* ------------------------------------------------------------------ */
/* The verdict                                                         */
/* ------------------------------------------------------------------ */

/**
 * What a free rule concluded.
 *
 * - `unsubscribe` — a verified request to stop. Suppresses and closes the lead.
 * - `bounce` — the mail system says the address is permanently undeliverable.
 *   Suppresses and closes the lead.
 * - `auto_reply` — an out-of-office or other machine answer. Stops automation
 *   for this message and suppresses NOTHING.
 * - `ambiguous_opt_out` — opt-out words from a speaker we could not verify.
 *   The thread is already frozen upstream; this only names it for the Inbox.
 */
export const REPLY_RULE_KINDS = [
  "unsubscribe",
  "bounce",
  "auto_reply",
  "ambiguous_opt_out",
] as const;

export type ReplyRuleKind = (typeof REPLY_RULE_KINDS)[number];

/** A rule fired, named by the rule rather than by a slice of the message. */
export type ReplyRuleVerdict = { kind: ReplyRuleKind; rule: string };

/* ------------------------------------------------------------------ */
/* Bounces                                                             */
/* ------------------------------------------------------------------ */

/** Local parts a mail system reports failures from. */
const DAEMON_LOCAL_PARTS: readonly string[] = [
  "mailer-daemon",
  "postmaster",
  "mail-daemon",
  "mailerdaemon",
  "no-reply-delivery",
];

/**
 * Permanent-failure wording. Soft failures ("mailbox full", "temporarily
 * deferred", "try again later") are deliberately absent: a retryable failure
 * must not suppress an address for good.
 */
const HARD_BOUNCE_PHRASES: readonly string[] = [
  "delivery status notification (failure)",
  "undelivered mail returned to sender",
  "permanent error",
  "permanent failure",
  "address not found",
  "recipient address rejected",
  "user unknown",
  "no such user",
  "mailbox unavailable",
  "does not exist",
  "550 5.1.1",
  "550 5.4.1",
];

function bounceRule(
  message: InboundMessageText,
  scan: string,
  outboundRecipient: string | null,
): ReplyRuleVerdict | null {
  // A bounce never comes from the person we mailed. Checking this first is
  // what stops "your reply bounced back to me" from suppressing a live lead.
  if (
    message.fromAddress !== undefined &&
    outboundRecipient !== null &&
    message.fromAddress === outboundRecipient
  ) {
    return null;
  }
  const localPart = (message.fromAddress ?? "").split("@")[0];
  const fromDaemon = DAEMON_LOCAL_PARTS.includes(localPart);
  const failureHeader =
    message.headers["x-failed-recipients"] !== undefined ||
    (message.headers["auto-submitted"] ?? "").includes("auto-replied (failure)");
  if (!fromDaemon && !failureHeader) {
    return null;
  }
  for (const phrase of HARD_BOUNCE_PHRASES) {
    if (scan.includes(phrase)) {
      return { kind: "bounce", rule: `hard_bounce:${phrase.replace(/\s+/g, "_")}` };
    }
  }
  // A daemon said something we do not recognise as permanent. That is not a
  // reply either, so it stops automation without suppressing anything.
  return fromDaemon ? { kind: "auto_reply", rule: "delivery_notice" } : null;
}

/* ------------------------------------------------------------------ */
/* Automatic answers                                                   */
/* ------------------------------------------------------------------ */

/** Subject wording almost every mail client puts on a vacation responder. */
const AUTO_REPLY_SUBJECT_PHRASES: readonly string[] = [
  "out of office",
  "out of the office",
  "automatic reply",
  "auto-reply",
  "autoreply",
  "away from the office",
  "annual leave",
  "on vacation",
  "abwesenheitsnotiz",
];

/** Body wording, read only from the first lines — a vacation responder says
 *  it immediately, while a human might mention a holiday anywhere. */
const AUTO_REPLY_BODY_PHRASES: readonly string[] = [
  "out of the office",
  "out of office",
  "on annual leave",
  "on parental leave",
  "automatic reply",
  "i am away until",
  "i will be back on",
];

const AUTO_REPLY_BODY_SCAN_LENGTH = 400;

function autoReplyRule(
  message: InboundMessageText,
  subjectScan: string,
  bodyScan: string,
): ReplyRuleVerdict | null {
  const autoSubmitted = message.headers["auto-submitted"] ?? "";
  if (autoSubmitted.startsWith("auto-")) {
    return { kind: "auto_reply", rule: "header_auto_submitted" };
  }
  if (
    message.headers["x-autoreply"] !== undefined ||
    message.headers["x-autorespond"] !== undefined ||
    (message.headers["precedence"] ?? "").includes("auto_reply")
  ) {
    return { kind: "auto_reply", rule: "header_autoreply" };
  }
  for (const phrase of AUTO_REPLY_SUBJECT_PHRASES) {
    if (subjectScan.includes(phrase)) {
      return { kind: "auto_reply", rule: `subject:${phrase.replace(/\s+/g, "_")}` };
    }
  }
  const opening = bodyScan.slice(0, AUTO_REPLY_BODY_SCAN_LENGTH);
  for (const phrase of AUTO_REPLY_BODY_PHRASES) {
    if (opening.includes(phrase)) {
      return { kind: "auto_reply", rule: `body:${phrase.replace(/\s+/g, "_")}` };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The one entry point                                                 */
/* ------------------------------------------------------------------ */

/** Lower-case and collapse whitespace; nothing else, and always bounded. */
function scanText(value: string | undefined): string {
  return (value ?? "")
    .slice(0, INBOUND_BODY_SCAN_MAX_LENGTH)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const OPT_OUT_RANK: Record<OptOutSignal, number> = {
  none: 0,
  ambiguous: 1,
  explicit: 2,
};

/**
 * Run every free rule over one message, strongest first.
 *
 * Order is the order of consequence: a request to stop outranks a machine
 * answer, and a permanent delivery failure outranks an out-of-office note.
 *
 * `receiptSignal` is the verdict the inbound callback already computed over
 * the raw payload (`emailEventReceipts.providerFacts.optOutSignal`) — the
 * same rule, run earlier and for free. It is re-run here over the STORED
 * message because a receipt written before that rule existed, or by the
 * quarantine replay, carries `none` by default, and the stored row is the
 * only other copy of the words.
 */
export function detectReplyRule(args: {
  message: InboundMessageText;
  receiptSignal: OptOutSignal;
  /** The address the application would mail next; never from the payload. */
  outboundRecipient: string | null;
}): ReplyRuleVerdict | null {
  const scanned = evaluateOptOutText({
    subject: args.message.subject,
    extractedText: args.message.body,
  });
  const signal =
    OPT_OUT_RANK[scanned.signal] > OPT_OUT_RANK[args.receiptSignal]
      ? scanned.signal
      : args.receiptSignal;
  const rule = scanned.rule ?? "receipt_rule";

  if (signal === "explicit") {
    return { kind: "unsubscribe", rule };
  }

  const subjectScan = scanText(args.message.subject);
  const bodyScan = scanText(args.message.body);
  const bounce = bounceRule(args.message, `${subjectScan} ${bodyScan}`, args.outboundRecipient);
  if (bounce !== null) {
    return bounce;
  }
  const auto = autoReplyRule(args.message, subjectScan, bodyScan);
  if (auto !== null) {
    return auto;
  }
  if (signal === "ambiguous") {
    return { kind: "ambiguous_opt_out", rule };
  }
  return null;
}
