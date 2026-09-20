/**
 * Inbox validators: conversation state, tabs, notes and takeover reasons, the
 * reply disposition vocabulary, inbound body bounds, opt-out detection and
 * the provider event-receipt / quarantine keys.
 */
import { normalizeEmailAddress } from "./shared";
import { v } from "convex/values";

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
