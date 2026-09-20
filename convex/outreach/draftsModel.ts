/**
 * Outreach — drafts, approvals and the send boundary (architecture §4.3/§8).
 *
 * This domain owns everything between "the agent wants to say this" and "the
 * provider accepted it": immutable draft revisions, their approvals, the
 * suppression list, the send lifecycle and its attempt/receipt ledger. It
 * owns neither the reply that comes back (inbox/) nor the lead itself.
 *
 * A draft ROW is one immutable revision of {recipient, sender inbox, subject,
 * body, reply parent}; `payloadHash` commits to the canonical serialization
 * of those fields. Nothing here edits a row in place.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { AuthCtx } from "../lib/auth";
import {
  boundedString,
  computePayloadHash,
  domainError,
  DRAFT_BODY_MAX_LENGTH,
  DRAFT_EVIDENCE_ID_MAX_LENGTH,
  DRAFT_EVIDENCE_MAX_ITEMS,
  DRAFT_SUBJECT_MAX_LENGTH,
  invalid,
  normalizeEmailAddress,
  PROVIDER_REF_MAX_LENGTH,
} from "../lib/validators";
import type { EndpointOperation } from "../lib/validators";
import { conversationFields, draftFields } from "../schema";
import { v } from "convex/values";

export const vConversationDoc = v.object({
  _id: v.id("conversations"),
  _creationTime: v.number(),
  ...conversationFields,
});

export const vDraftDoc = v.object({
  _id: v.id("drafts"),
  _creationTime: v.number(),
  ...draftFields,
});

export async function getConversationInOrg(
  ctx: AuthCtx,
  orgId: Id<"orgs">,
  conversationId: Id<"conversations">,
): Promise<Doc<"conversations">> {
  const conversation = await ctx.db.get("conversations", conversationId);
  if (conversation === null || conversation.orgId !== orgId) {
    throw domainError("NOT_FOUND", "conversation not found");
  }
  return conversation;
}

export async function getDraftInOrg(
  ctx: AuthCtx,
  orgId: Id<"orgs">,
  draftId: Id<"drafts">,
): Promise<Doc<"drafts">> {
  const draft = await ctx.db.get("drafts", draftId);
  if (draft === null || draft.orgId !== orgId) {
    throw domainError("NOT_FOUND", "draft not found");
  }
  return draft;
}

function endpointFor(replyToMessageRef: string | undefined): EndpointOperation {
  return replyToMessageRef === undefined ? "send" : "reply";
}

/**
 * The single immutable-revision write path shared by `revise` and
 * `createRevision`. Runs entirely inside the caller's transaction: insert
 * the new revision row, move `currentDraftId` and advance `contextVersion`.
 */
export async function installRevision(
  ctx: MutationCtx,
  args: {
    org: Doc<"orgs">;
    conversation: Doc<"conversations">;
    agent: Doc<"agents"> | null;
    recipient: string;
    subject: string;
    body: string;
    evidenceIds: string[];
    replyToMessageRef?: string;
    createdBy: string;
    requestId?: string;
    /** Booking-proposal link (§4.3): already validated by the caller —
     *  the approval and dispatch gates re-check it against live state. */
    bookingId?: Id<"bookings">;
    bookingVersion?: number;
  },
): Promise<Doc<"drafts">> {
  const normalizedRecipient = normalizeEmailAddress(args.recipient);
  const subject = boundedString(args.subject, "subject", {
    min: 1,
    max: DRAFT_SUBJECT_MAX_LENGTH,
  });
  const body = boundedString(args.body, "body", {
    min: 1,
    max: DRAFT_BODY_MAX_LENGTH,
  });
  if (args.evidenceIds.length > DRAFT_EVIDENCE_MAX_ITEMS) {
    throw invalid(
      `evidenceIds allows at most ${DRAFT_EVIDENCE_MAX_ITEMS} entries`,
    );
  }
  const evidenceIds = args.evidenceIds.map((id, index) =>
    boundedString(id, `evidenceIds[${index}]`, {
      min: 1,
      max: DRAFT_EVIDENCE_ID_MAX_LENGTH,
    }),
  );
  const replyToMessageRef =
    args.replyToMessageRef === undefined
      ? undefined
      : boundedString(args.replyToMessageRef, "replyToMessageRef", {
          min: 1,
          max: PROVIDER_REF_MAX_LENGTH,
        });

  const latest = await ctx.db
    .query("drafts")
    .withIndex("by_conversationId_and_revision", (q) =>
      q.eq("conversationId", args.conversation._id),
    )
    .order("desc")
    .first();
  const revision = (latest?.revision ?? 0) + 1;
  const endpointOperation = endpointFor(replyToMessageRef);
  const payloadHash = await computePayloadHash({
    endpointOperation,
    inboxRef: args.conversation.inboxRef,
    normalizedRecipient,
    subject,
    body,
    replyToMessageRef: replyToMessageRef ?? null,
  });

  const now = Date.now();
  if (latest !== null && latest.supersededAt === undefined) {
    // `state` and `supersededAt` move together — see `vDraftState`.
    await ctx.db.patch("drafts", latest._id, {
      state: "superseded",
      supersededAt: now,
    });
  }
  const draftId = await ctx.db.insert("drafts", {
    orgId: args.org._id,
    conversationId: args.conversation._id,
    inboxRef: args.conversation.inboxRef,
    revision,
    recipient: boundedString(args.recipient, "recipient", {
      min: 3,
      max: PROVIDER_REF_MAX_LENGTH,
    }),
    normalizedRecipient,
    subject,
    body,
    payloadHash,
    // A new current draft is an explicit context change (§8): bump the
    // version first so this revision binds the post-change context.
    basedOnContextVersion: args.conversation.contextVersion + 1,
    // A draft with no agent behind it is written under revision 0, which no
    // live agent ever carries — so it can never pass a revision check.
    agentRevision: args.agent?.revision ?? 0,
    policyVersion: args.org.policyVersion,
    state: "current",
    evidenceIds,
    createdBy: args.createdBy,
    createdAt: now,
    ...(replyToMessageRef !== undefined ? { replyToMessageRef } : {}),
    ...(args.bookingId !== undefined ? { bookingId: args.bookingId } : {}),
    ...(args.bookingVersion !== undefined
      ? { bookingVersion: args.bookingVersion }
      : {}),
    ...(args.requestId !== undefined ? { requestId: args.requestId } : {}),
  });
  await ctx.db.patch("conversations", args.conversation._id, {
    currentDraftId: draftId,
    contextVersion: args.conversation.contextVersion + 1,
    updatedAt: now,
  });

  const draft = await ctx.db.get("drafts", draftId);
  if (draft === null) {
    throw domainError("NOT_FOUND", "draft not found after insert");
  }

  // A parked (pre-dispatch) send intent authorized against the superseded
  // revision can never legally dispatch now — retire it in the same
  // transaction so its stale wake cannot block the corrected send.
  await ctx.runMutation(internal.outreach.sendControls.cancelParkedConversationAttempts, {
    orgId: args.org._id,
    conversationId: args.conversation._id,
    reason: `revision ${revision} superseded the draft it was authorized against`,
  });

  return draft;
}

/**
 * Prove a draft may carry a `bookingId`/`bookingVersion` link (§4.3): the
 * booking lives in this org, is still `proposed`, is still the version
 * the content was written against, and belongs to the lead this conversation
 * is bound to. The same check re-runs at approval and at dispatch, so a
 * booking that moved on between draft and send can never be mailed.
 */
export async function assertBookingLink(
  ctx: AuthCtx,
  conversation: Doc<"conversations">,
  bookingId: Id<"bookings">,
  bookingVersion: number,
): Promise<void> {
  const booking = await ctx.db.get("bookings", bookingId);
  if (booking === null || booking.orgId !== conversation.orgId) {
    throw domainError("NOT_FOUND", "booking not found");
  }
  if (booking.state !== "proposed") {
    throw domainError(
      "CONFLICT",
      `booking is ${booking.state}; a draft can only carry a live proposal`,
    );
  }
  if (booking.version !== bookingVersion) {
    throw domainError(
      "CONFLICT",
      `booking version is ${booking.version}, not ${bookingVersion} — draft a fresh proposal`,
    );
  }
  if (
    conversation.prospectId === undefined ||
    booking.prospectId !== conversation.prospectId
  ) {
    throw domainError(
      "CONFLICT",
      "the booking belongs to a different lead than the conversation",
    );
  }
}

/** Request-id replay: a committed revision returns itself. */
export async function findRevisionByRequestId(
  ctx: MutationCtx,
  orgId: Id<"orgs">,
  requestId: string,
): Promise<Doc<"drafts"> | null> {
  return await ctx.db
    .query("drafts")
    .withIndex("by_orgId_and_requestId", (q) =>
      q.eq("orgId", orgId).eq("requestId", requestId),
    )
    .unique();
}
