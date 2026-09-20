/**
 * The internal draft write path (P09 draft-proposal step / P11 reply flow):
 * the pipeline's way to propose revision N+1 without a human in the loop.
 */
import { internalMutation } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { boundedString, domainError, invalid } from "../lib/validators";
import {
  assertBookingLink,
  findRevisionByRequestId,
  installRevision,
  vDraftDoc,
} from "./draftsModel";
import { v } from "convex/values";

/**
 * Propose a new immutable draft revision on a conversation (pipeline path).
 * Validates the recipient, bounds subject/body, records
 * `basedOnContextVersion`, `agentRevision` and `policyVersion`, and
 * installs the revision. `requestId` dedupes retries.
 */
export const createRevision = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
    evidenceIds: v.optional(v.array(v.string())),
    replyToMessageRef: v.optional(v.string()),
    requestId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    /** Booking-proposal link (§4.3, P19): the proposal this content offers
     *  and the booking version it was written against. Validated against
     *  live state here, then AGAIN at approval and dispatch — a rescheduled
     *  or cancelled booking can never go out under the old content. */
    bookingId: v.optional(v.id("bookings")),
    bookingVersion: v.optional(v.number()),
  },
  returns: vDraftDoc,
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null) {
      throw domainError("NOT_FOUND", "conversation not found");
    }
    if ((args.bookingId === undefined) !== (args.bookingVersion === undefined)) {
      throw invalid("bookingId and bookingVersion must be supplied together");
    }
    const requestId =
      args.requestId === undefined
        ? undefined
        : boundedString(args.requestId, "requestId", { min: 1, max: 100 });
    if (requestId !== undefined) {
      const replayed = await findRevisionByRequestId(
        ctx,
        conversation.workspaceId,
        requestId,
      );
      if (replayed !== null) {
        // Bind the dedupe to this conversation — a requestId recorded for a
        // different conversation is a CONFLICT, not a silent replay.
        if (replayed.conversationId !== args.conversationId) {
          throw domainError(
            "CONFLICT",
            `requestId ${requestId} already recorded a different revision`,
          );
        }
        return replayed;
      }
    }
    // After the replay check: a retried create returns its committed draft
    // even when the booking has since moved; a FRESH link is always proved
    // against live state.
    if (args.bookingId !== undefined && args.bookingVersion !== undefined) {
      await assertBookingLink(
        ctx,
        conversation,
        args.bookingId,
        args.bookingVersion,
      );
    }
    const workspace = await ctx.db.get("workspaces", conversation.workspaceId);
    if (workspace === null) {
      throw domainError("NOT_FOUND", "workspace not found");
    }
    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);
    const draft = await installRevision(ctx, {
      workspace,
      conversation,
      agent,
      recipient: args.recipient,
      subject: args.subject,
      body: args.body,
      evidenceIds: args.evidenceIds ?? [],
      replyToMessageRef: args.replyToMessageRef,
      createdBy:
        args.createdBy === undefined
          ? "workflow"
          : boundedString(args.createdBy, "createdBy", { min: 1, max: 300 }),
      requestId,
      ...(args.bookingId !== undefined && args.bookingVersion !== undefined
        ? { bookingId: args.bookingId, bookingVersion: args.bookingVersion }
        : {}),
    });
    await recordActivityEvent(ctx, {
      workspaceId: workspace._id,
      kind: "draft_created",
      summary: `Draft revision ${draft.revision} proposed for ${draft.normalizedRecipient}`,
      actor: "workflow",
      dedupeKey: `draft:${draft._id}:created`,
      conversationId: conversation._id,
    });
    return draft;
  },
});
