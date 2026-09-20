/**
 * Outreach validators: draft state and payload bounds, the approval verdict
 * and draft resolution vocabulary, the send-attempt state machine and the
 * suppression list's kinds and reasons.
 */
import { canonicalJson } from "./shared";
import { v } from "convex/values";

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
