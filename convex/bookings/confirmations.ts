/**
 * The confirmed-agreement writes: confirming a meeting.
 *
 * Only a human records the actual agreement — the agreed start/end, the IANA
 * timezone the prospect stated them in, and a short basis for how the time
 * was confirmed. There is no calendar connector: `confirmationSource` is
 * `manual`. `booked` is reached ONLY through `confirm`.
 */
import { mutation } from "../_generated/server";
import { recordMeetingBooked } from "../activity/model";
import { appendLeadEvent, findLeadEventByOperationKey } from "../leads/events";
import { requireOrgMember } from "../lib/auth";
import {
  assertAgreedBookingTimes,
  assertExpectedVersion,
  BOOKING_CONFIRMATION_NOTE_MAX_LENGTH,
  boundedString,
  domainError,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
  TERMINAL_LEAD_STAGES,
} from "../lib/validators";
import {
  loadBookingForWrite,
  loadProspect,
  vBookingDoc,
} from "./model";
import { v } from "convex/values";

/**
 * Record that a human agreed a real meeting — the ONLY path from `proposed`
 * to `confirmed`, and from there the only path that puts the lead at
 * `booked`.
 *
 * What must be supplied is the AGREEMENT, not an interpretation: the actual
 * agreed start and end as instants, the IANA timezone the prospect stated
 * them in, and `confirmationNote` — the short basis of the agreement ("they
 * confirmed Tuesday 3pm ET by email", "agreed on the call"). A clicked link,
 * a suggested slot, an ambiguous reply or a model's read of the thread is
 * none of those, so none of them can call this.
 *
 * There is no calendar connector: `confirmationSource` is always `manual`.
 */
export const confirm = mutation({
  args: {
    orgId: v.id("orgs"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
    timezone: v.string(),
    /** How the time was actually agreed — the record's stated basis. */
    confirmationNote: v.string(),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const confirmationNote = boundedString(
      args.confirmationNote,
      "confirmationNote",
      { min: 1, max: BOOKING_CONFIRMATION_NOTE_MAX_LENGTH },
    );
    const booking = await loadBookingForWrite(
      ctx,
      args.orgId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.orgId,
      `booking:${args.bookingId}:confirmed:${requestId}`,
    );
    if (prior !== null) {
      const same =
        booking.startsAt === args.startsAt &&
        booking.endsAt === args.endsAt &&
        booking.timezone === args.timezone;
      if (!same) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different confirmation`,
        );
      }
      return booking;
    }
    if (booking.state !== "proposed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a live proposal can be confirmed`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    const now = Date.now();
    const times = assertAgreedBookingTimes(
      {
        startsAt: args.startsAt,
        endsAt: args.endsAt,
        timezone: args.timezone,
      },
      now,
    );
    const prospect = await loadProspect(
      ctx,
      args.orgId,
      booking.prospectId,
    );
    if (TERMINAL_LEAD_STAGES.includes(prospect.stage)) {
      throw domainError(
        "CONFLICT",
        `lead is ${prospect.stage} — it must be reopened before a booking is confirmed`,
      );
    }
    // PLAN §9.5: this mutation IS the user's "Mark as booked". It is the only
    // writer of `meeting_booked`, and it sets the stage outright rather than
    // advancing it, because the human assertion outranks the pipeline order.
    const nextStage = "meeting_booked" as const;
    const stageReason = boundedString(
      `Meeting confirmed — ${confirmationNote}`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    await ctx.db.patch("bookings", booking._id, {
      state: "confirmed",
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      timezone: times.timezone,
      confirmationSource: "manual",
      confirmedBy: identityKey,
      confirmedAt: now,
      confirmationNote,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, {
      stage: nextStage,
      stageReason,
      // The meeting is the next thing that happens on this lead, so the state
      // machine has nothing to do until it does.
      nextActionAt: undefined,
      updatedAt: now,
    });
    await appendLeadEvent(ctx, {
      orgId: args.orgId,
      prospectId: prospect._id,
      kind: "booking_confirmed",
      summary: `Meeting confirmed for ${new Date(times.startsAt).toISOString()} ${times.timezone} — ${confirmationNote}`,
      operationKey: `booking:${booking._id}:confirmed:${requestId}`,
      bookingId: booking._id,
      ...(nextStage === prospect.stage
        ? {}
        : { fromStage: prospect.stage, toStage: nextStage }),
      actor: { source: "human", identityKey },
      details: { reason: confirmationNote },
    });
    // The bell's "meeting booked" event (PLAN §5). Written here because this
    // mutation is the single writer of a booked meeting — the user's own
    // click — so the bell can never announce one nobody confirmed.
    await recordMeetingBooked(ctx, {
      orgId: args.orgId,
      bookingId: booking._id,
      prospectId: prospect._id,
      startsAt: times.startsAt,
      timezone: times.timezone,
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});
