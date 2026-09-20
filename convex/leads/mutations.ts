/**
 * Lead writes: approval (PLAN §9.3), notes, and the two provider-fact
 * derivations the send and inbox boundaries call.
 *
 * Three rules govern every write below:
 *
 *   `stage` + `nextActionAt` is the whole state machine (PLAN §7). An
 *   automatic transition may only move a lead forward (`advancedLeadStage`),
 *   and it never enters or leaves `closed_lost` / `rejected`, nor un-parks a
 *   lead sitting in `needs_attention`.
 *
 *   Lead approval is not email approval (PLAN §9.3). Approving here says
 *   "yes, contact this person" — it authorises finding the address and
 *   drafting. Approving the text of one message is an `approvals` row.
 *
 *   `lastContactedAt` comes ONLY from a send acceptance and `lastReplyAt`
 *   ONLY from a verified inbound reply. Drafting a message is not contacting
 *   anyone.
 *
 * Every business update and its `leadEvents` row are written in ONE
 * transaction, so the history can never disagree with the lead.
 */
import type { Doc } from "../_generated/dataModel";
import { internalMutation, mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import {
  advancedLeadStage,
  boundedString,
  domainError,
  invalid,
  LEAD_EVENT_NOTE_MAX_LENGTH,
  MAX_LIST_LIMIT,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  vLeadApproval,
  vLeadStage,
} from "../lib/validators";
import { decideOne } from "./approval";
import {
  appendLeadEvent,
  findLeadEventByOperationKey,
  vLeadEventDoc,
} from "./events";
import { loadProspectForWrite } from "./model";
import { v } from "convex/values";

/**
 * "Yes, contact this person" — or "no, never". One lead or a selection.
 *
 * This authorises finding the address and drafting; it sends nothing. The
 * email itself is approved separately, per draft, in `approvals`.
 *
 * Rejecting also moves the lead to the `rejected` stage, clears
 * `nextActionAt` so the state machine stops offering it work, and retires the
 * outreach it had queued (`leads/approval.ts`). Per PLAN §9.1 it never
 * refunds by itself: a reveal already in flight still bills, and its address
 * is still stored.
 *
 * `requestId` dedupes per lead through the lead-event index, so a
 * double-clicked Approve — or a retried bulk action — records one decision
 * each. The same requestId carrying a different verdict for a lead is a
 * CONFLICT.
 */
export const setApproval = mutation({
  args: {
    orgId: v.id("orgs"),
    prospectIds: v.array(v.id("prospects")),
    approval: vLeadApproval,
    /** Stated basis; a bulk rejection carries one for every lead in it. */
    reason: v.optional(v.string()),
    requestId: v.string(),
  },
  returns: v.object({
    /** Leads whose decision this call recorded. */
    decided: v.number(),
    /** Leads already carrying that decision — a no-op, not a new event. */
    unchanged: v.number(),
  }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    if (args.approval === "pending") {
      throw invalid("approval cannot be set back to pending");
    }
    if (args.prospectIds.length === 0) {
      throw invalid("prospectIds must name at least one lead");
    }
    if (args.prospectIds.length > MAX_LIST_LIMIT) {
      throw invalid(`at most ${MAX_LIST_LIMIT} leads can be decided at once`);
    }
    const reason =
      args.reason === undefined
        ? undefined
        : boundedString(args.reason, "reason", {
            min: 1,
            max: PROSPECT_STAGE_REASON_MAX_LENGTH,
          });

    let decided = 0;
    let unchanged = 0;
    for (const prospectId of new Set(args.prospectIds)) {
      const applied = await decideOne(ctx, {
        orgId: args.orgId,
        prospectId,
        approval: args.approval,
        identityKey,
        requestId,
        ...(reason !== undefined ? { reason } : {}),
      });
      if (applied) {
        decided += 1;
      } else {
        unchanged += 1;
      }
    }
    return { decided, unchanged };
  },
});

/**
 * Append a note to the lead's history. A note IS the event — the lead row is
 * untouched (no `updatedAt` move), so annotating a lead can never reorder a
 * Contacts view. `requestId` dedupes the append: a retried note returns the
 * row it already wrote, and the same requestId carrying a different body is a
 * CONFLICT.
 */
export const addNote = mutation({
  args: {
    orgId: v.id("orgs"),
    prospectId: v.id("prospects"),
    body: v.string(),
    requestId: v.string(),
  },
  returns: vLeadEventDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const note = boundedString(args.body, "body", {
      min: 1,
      max: LEAD_EVENT_NOTE_MAX_LENGTH,
    });
    await loadProspectForWrite(ctx, args.orgId, args.prospectId);
    const operationKey = `lead:${args.prospectId}:note:${requestId}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.orgId,
      operationKey,
    );
    if (prior !== null) {
      if (prior.details?.note !== note) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different note`,
        );
      }
      return prior;
    }
    const eventId = await appendLeadEvent(ctx, {
      orgId: args.orgId,
      prospectId: args.prospectId,
      kind: "note_added",
      summary: "Note added by a team member",
      operationKey,
      actor: { source: "human", identityKey },
      details: { note },
    });
    if (eventId === null) {
      throw domainError("CONFLICT", "note operation key already recorded");
    }
    const event = await ctx.db.get("leadEvents", eventId);
    if (event === null) {
      throw domainError("NOT_FOUND", "lead event not found after insert");
    }
    return event;
  },
});

/**
 * THE contacted / meeting_proposed derivation — called by the send boundary
 * exactly once per provider-acknowledged send, inside the outcome
 * transaction. It is deliberately non-throwing: a broken association must
 * never roll back the acceptance record the send boundary just committed; it
 * simply records less.
 *
 * What it records, all in one patch:
 *   `lastContactedAt` — the monotonic max of every accepted send.
 *   `contacted` — when the lead has not already advanced past it.
 *   `meeting_proposed` — ONLY when the sent draft carries a live
 *   `bookingId`/`bookingVersion` link that still resolves to a `proposed`
 *   booking on this lead. A stale or moved booking is skipped — the send
 *   itself is still a contact. A meeting is BOOKED only by the user
 *   (PLAN §9.5); nothing here can set that stage.
 *
 * A `send_accepted` event is written per attempt; a stage event is written
 * only when the stage actually moved.
 */
export const markSendAccepted = internalMutation({
  args: {
    sendAttemptId: v.id("sendAttempts"),
    at: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    stage: v.optional(vLeadStage),
  }),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("sendAttempts", args.sendAttemptId);
    if (attempt === null) {
      return { applied: false };
    }
    const conversation = await ctx.db.get(
      "conversations",
      attempt.conversationId,
    );
    if (conversation === null || conversation.prospectId === undefined) {
      return { applied: false };
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.orgId !== attempt.orgId) {
      return { applied: false };
    }
    const draft = await ctx.db.get("drafts", attempt.draftId);

    // The booking link the dispatch gate already validated — re-checked here
    // because a confirm/reschedule could have landed between the two.
    let booking: Doc<"bookings"> | null = null;
    if (draft !== null && draft.bookingId !== undefined) {
      const linked = await ctx.db.get("bookings", draft.bookingId);
      if (
        linked !== null &&
        linked.orgId === prospect.orgId &&
        linked.prospectId === prospect._id &&
        linked.state === "proposed" &&
        linked.version === draft.bookingVersion
      ) {
        booking = linked;
      }
    }

    const now = Date.now();
    const nextStage = advancedLeadStage(
      prospect.stage,
      booking !== null ? "meeting_proposed" : "contacted",
    );
    const moved = nextStage !== prospect.stage;
    await ctx.db.patch("prospects", prospect._id, {
      lastContactedAt: Math.max(prospect.lastContactedAt ?? 0, args.at),
      updatedAt: now,
      ...(moved
        ? {
            stage: nextStage,
            stageReason:
              booking !== null
                ? "Booking proposal send accepted by the provider"
                : "Outbound send accepted by the provider",
          }
        : {}),
    });
    // `booking` is only set when the linked draft exists — the narrowed
    // `draft !== null` here is what that implication looks like to the
    // checker.
    if (booking !== null && draft !== null) {
      await ctx.db.patch("bookings", booking._id, {
        ...(booking.conversationId === undefined
          ? { conversationId: conversation._id }
          : {}),
        ...(booking.draftId === undefined ? { draftId: draft._id } : {}),
        updatedAt: now,
      });
    }
    await appendLeadEvent(ctx, {
      orgId: prospect.orgId,
      prospectId: prospect._id,
      kind: "send_accepted",
      summary: `Outbound send accepted by the provider (attempt ${attempt._id})`,
      operationKey: `lead:${prospect._id}:send-accepted:${attempt._id}`,
      ...(booking !== null ? { bookingId: booking._id } : {}),
    });
    if (moved) {
      await appendLeadEvent(ctx, {
        orgId: prospect.orgId,
        prospectId: prospect._id,
        kind: booking !== null ? "booking_proposed" : "stage_changed",
        summary:
          booking !== null
            ? "Booking proposal delivered — lead is meeting_proposed"
            : `Stage ${prospect.stage} → ${nextStage}`,
        operationKey:
          // Keyed per ATTEMPT, not per booking: a human can pull the stage
          // back down and a second send carrying the same live booking link
          // must still record its re-advance — the row and the append-only
          // history can never disagree. True replays still dedupe because
          // one attempt writes this key at most once.
          booking !== null
            ? `lead:${prospect._id}:booking-sent:${booking._id}:${attempt._id}`
            : `lead:${prospect._id}:contacted:${attempt._id}`,
        fromStage: prospect.stage,
        toStage: nextStage,
        ...(booking !== null ? { bookingId: booking._id } : {}),
      });
    }
    return { applied: true, stage: nextStage };
  },
});

/**
 * THE replied derivation — called by inbound ingest once per verified inbound on
 * a conversation already linked to a lead, and by
 * `conversations.associateProspect` when a held thread is bound. Keyed on the
 * provider message ref so a replayed receipt dedupes rather than double-
 * counting. Non-throwing like `markSendAccepted`: a reply fact must never
 * roll back the receipt that carries it.
 *
 * Clearing `nextActionAt` is the accounting-free half of PLAN §9.1's "a reply
 * arrives → follow-ups for that conversation cancelled in the same mutation
 * that stores the reply": the lead stops being due, so no further follow-up
 * step is ever selected for it. Superseding an unsent draft is the outreach
 * loop's (T40), which owns `drafts`.
 */
export const markReplied = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    messageRef: v.string(),
    at: v.number(),
  },
  returns: v.object({
    applied: v.boolean(),
    stage: v.optional(vLeadStage),
  }),
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (conversation === null || conversation.prospectId === undefined) {
      return { applied: false };
    }
    const prospect = await ctx.db.get("prospects", conversation.prospectId);
    if (prospect === null || prospect.orgId !== conversation.orgId) {
      return { applied: false };
    }
    const messageRef = boundedString(args.messageRef, "messageRef", {
      min: 1,
      max: 300,
    });
    const operationKey = `lead:${prospect._id}:replied:${messageRef}`;
    const prior = await findLeadEventByOperationKey(
      ctx,
      prospect.orgId,
      operationKey,
    );
    if (prior !== null) {
      return { applied: true, stage: prospect.stage };
    }
    const now = Date.now();
    const nextStage = advancedLeadStage(prospect.stage, "replied");
    const moved = nextStage !== prospect.stage;
    await ctx.db.patch("prospects", prospect._id, {
      lastReplyAt: Math.max(prospect.lastReplyAt ?? 0, args.at),
      nextActionAt: undefined,
      updatedAt: now,
      ...(moved
        ? {
            stage: nextStage,
            stageReason: "Verified inbound reply on the linked conversation",
          }
        : {}),
    });
    await appendLeadEvent(ctx, {
      orgId: prospect.orgId,
      prospectId: prospect._id,
      kind: "reply_received",
      summary: "Verified inbound reply recorded on the linked conversation",
      operationKey,
    });
    if (moved) {
      await appendLeadEvent(ctx, {
        orgId: prospect.orgId,
        prospectId: prospect._id,
        kind: "stage_changed",
        summary: `Stage ${prospect.stage} → replied`,
        operationKey: `lead:${prospect._id}:stage-replied:${messageRef}`,
        fromStage: prospect.stage,
        toStage: nextStage,
      });
    }
    return { applied: true, stage: nextStage };
  },
});
