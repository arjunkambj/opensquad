/**
 * Draft reads and the human revision path.
 *
 * `revise` inserts revision N+1, moves `conversations.currentDraftId` and
 * advances `contextVersion` (a new current draft is an explicit context
 * change). An approval is recorded against a specific revision, so a newer
 * revision simply leaves the old approval inapplicable; old revisions keep
 * `supersededAt` so history stays auditable.
 */
import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { recordActivityEvent } from "../activity/model";
import { requireOrgMember } from "../lib/auth";
import {
  boundedLimit,
  boundedString,
  domainError,
  invalid,
} from "../lib/validators";
import {
  findRevisionByRequestId,
  getConversationInOrg,
  getDraftInOrg,
  installRevision,
  vDraftDoc,
} from "./draftsModel";
import { v } from "convex/values";

/** One draft revision; foreign or cross-org IDs return `NOT_FOUND`. */
export const get = query({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
  },
  returns: vDraftDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    return await getDraftInOrg(ctx, args.orgId, args.draftId);
  },
});

/**
 * Revision history for one conversation, newest first, cursor-paginated.
 * Immutable rows are the audit trail — superseded revisions stay readable.
 */
export const listForConversation = query({
  args: {
    orgId: v.id("orgs"),
    conversationId: v.id("conversations"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    items: v.array(vDraftDoc),
    cursor: v.union(v.string(), v.null()),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);
    await getConversationInOrg(
      ctx,
      args.orgId,
      args.conversationId,
    );
    const limit = boundedLimit(args.limit);
    const result = await ctx.db
      .query("drafts")
      .withIndex("by_conversationId_and_revision", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      cursor: result.isDone ? null : result.continueCursor,
      hasMore: !result.isDone,
    };
  },
});

/**
 * Revise the current draft (owner/operator). Any send-field change inserts
 * revision N+1, moves `currentDraftId` and advances `contextVersion` — an
 * old approval can never silently apply to changed content (§8).
 *
 * `expectedRevision` is the optimistic-concurrency guard and the natural
 * idempotency: a replay sees `draft.revision !== expectedRevision` and gets
 * `CONFLICT` naming the current revision; `requestId` additionally dedupes
 * exact client retries to the recorded new row.
 */
export const revise = mutation({
  args: {
    orgId: v.id("orgs"),
    draftId: v.id("drafts"),
    expectedRevision: v.number(),
    recipient: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  returns: vDraftDoc,
  handler: async (ctx, args) => {
    const { identityKey, org } = await requireOrgMember(
      ctx,
      args.orgId,
    );
    const requestId =
      args.requestId === undefined
        ? undefined
        : boundedString(args.requestId, "requestId", { min: 1, max: 100 });

    const current = await getDraftInOrg(
      ctx,
      args.orgId,
      args.draftId,
    );
    if (requestId !== undefined) {
      const replayed = await findRevisionByRequestId(
        ctx,
        args.orgId,
        requestId,
      );
      if (replayed !== null) {
        // The requestId dedupe must bind THIS revision target: the same key
        // reused against a different draft/conversation is a CONFLICT, not
        // a silent replay of an unrelated revision.
        if (
          replayed.conversationId !== current.conversationId ||
          replayed.revision !== current.revision + 1
        ) {
          throw domainError(
            "CONFLICT",
            `requestId ${requestId} already recorded a different revision`,
          );
        }
        return replayed;
      }
    }

    if (current.revision !== args.expectedRevision) {
      throw domainError(
        "CONFLICT",
        `draft revision is ${current.revision}, not ${args.expectedRevision}`,
      );
    }
    const conversation = await getConversationInOrg(
      ctx,
      args.orgId,
      current.conversationId,
    );
    if (conversation.currentDraftId !== current._id) {
      throw domainError(
        "CONFLICT",
        "draft is not the conversation's current revision; revise the current draft instead",
      );
    }

    const recipient = args.recipient ?? current.recipient;
    const subject = args.subject ?? current.subject;
    const body = args.body ?? current.body;
    if (
      args.recipient === undefined &&
      args.subject === undefined &&
      args.body === undefined
    ) {
      throw invalid("revise requires at least one of recipient/subject/body");
    }

    const agent =
      conversation.agentId === undefined
        ? null
        : await ctx.db.get("agents", conversation.agentId);

    // The booking link survives a content edit ONLY while it still names a
    // live proposal at the version the draft was written against. A
    // confirmed/rescheduled/cancelled booking drops the link instead of
    // stranding the thread — the new revision is a plain message that can
    // never advance the lead to booking_proposed.
    let bookingLink:
      | { bookingId: Id<"bookings">; bookingVersion: number }
      | undefined;
    if (
      current.bookingId !== undefined &&
      current.bookingVersion !== undefined
    ) {
      const booking = await ctx.db.get("bookings", current.bookingId);
      if (
        booking !== null &&
        booking.orgId === conversation.orgId &&
        booking.state === "proposed" &&
        booking.version === current.bookingVersion &&
        booking.prospectId === conversation.prospectId
      ) {
        bookingLink = {
          bookingId: booking._id,
          bookingVersion: booking.version,
        };
      }
    }

    const draft = await installRevision(ctx, {
      org,
      conversation,
      agent,
      recipient,
      subject,
      body,
      evidenceIds: current.evidenceIds,
      replyToMessageRef: current.replyToMessageRef,
      createdBy: identityKey,
      requestId,
      ...(bookingLink !== undefined ? bookingLink : {}),
    });

    await recordActivityEvent(ctx, {
      orgId: args.orgId,
      kind: "draft_revised",
      summary: `Draft revised to revision ${draft.revision} for ${draft.normalizedRecipient}`,
      actor: identityKey,
      dedupeKey: `draft:${draft._id}:revised`,
      conversationId: conversation._id,
    });
    return draft;
  },
});
