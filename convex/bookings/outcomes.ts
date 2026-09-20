/**
 * Cancelling a booking and recording what actually happened.
 *
 * Both fall the lead back to the last stage its facts still support (reply →
 * `replied`, accepted send → `contacted`, else the last non-booking stage
 * recorded) and set an EXPLICIT next action — never `won`/`lost`, which stay
 * human decisions. Both retire every unsent draft still offering the old
 * agreement.
 */
import { mutation } from "../_generated/server";
import { appendLeadEvent, findLeadEventByOperationKey } from "../leads/events";
import { requireOrgMember } from "../lib/auth";
import {
  assertExpectedVersion,
  BOOKING_CANCELLATION_REASON_MAX_LENGTH,
  boundedString,
  domainError,
  invalid,
  PROSPECT_STAGE_REASON_MAX_LENGTH,
} from "../lib/validators";
import {
  fallbackLeadStage,
  loadBookingForWrite,
  loadProspect,
  retireLinkedDrafts,
  vBookingDoc,
} from "./model";
import { v } from "convex/values";

/**
 * Cancel a live booking — proposed or confirmed — with a required stated
 * reason. The agreed times, timezone and confirmation details STAY on the
 * row: a cancellation records that the agreement was called off, it does not
 * erase that it existed.
 *
 * The lead falls back to the last stage its facts still support and gets an
 * explicit next action (caller-supplied, or the derived follow-up). Every
 * unsent draft still offering this booking is retired in the same
 * transaction.
 */
export const cancel = mutation({
  args: {
    orgId: v.id("orgs"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    reason: v.string(),
    /** Override the derived follow-up action. */
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const reason = boundedString(args.reason, "reason", {
      min: 1,
      max: BOOKING_CANCELLATION_REASON_MAX_LENGTH,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.orgId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.orgId,
      `booking:${args.bookingId}:cancelled:${requestId}`,
    );
    if (prior !== null) {
      if (
        booking.state !== "cancelled" ||
        booking.cancellationReason !== reason
      ) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded a different cancellation`,
        );
      }
      return booking;
    }
    if (booking.state !== "proposed" && booking.state !== "confirmed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a live booking can be cancelled`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    const now = Date.now();
    const prospect = await loadProspect(
      ctx,
      args.orgId,
      booking.prospectId,
    );
    // Only a lead still sitting on a meeting stage falls back; a stage a
    // human set since stands.
    const inBookingStage =
      prospect.stage === "meeting_proposed" ||
      prospect.stage === "meeting_booked";
    const nextStage = inBookingStage
      ? await fallbackLeadStage(ctx, prospect)
      : prospect.stage;
    const stageReason = boundedString(
      `Booking cancelled — ${reason}`,
      "stageReason",
      { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
    );
    await ctx.db.patch("bookings", booking._id, {
      state: "cancelled",
      cancellationReason: reason,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, {
      ...(inBookingStage ? { stage: nextStage, stageReason } : { stageReason }),
      updatedAt: now,
    });
    await retireLinkedDrafts(
      ctx,
      booking,
      `booking cancelled — the proposal is no longer open`,
    );
    await appendLeadEvent(ctx, {
      orgId: args.orgId,
      prospectId: prospect._id,
      kind: "booking_cancelled",
      summary: `Booking cancelled — ${reason}`,
      operationKey: `booking:${booking._id}:cancelled:${requestId}`,
      bookingId: booking._id,
      ...(inBookingStage && nextStage !== prospect.stage
        ? { fromStage: prospect.stage, toStage: nextStage }
        : {}),
      actor: { source: "human", identityKey },
      details: {
        previousStartsAt: booking.startsAt,
        previousEndsAt: booking.endsAt,
        previousTimezone: booking.timezone,
        reason,
      },
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});

/**
 * Record what actually happened at a confirmed meeting: `completed` or
 * `no_show`. Callable only after the scheduled start has passed — a future
 * meeting has no outcome yet — and the agreed times stay on the row. The lead
 * falls back to the last stage its facts still support with an explicit next
 * action (follow up, or rebook a miss); `won` is NEVER implied by a completed
 * meeting — that call stays a human's.
 */
export const recordOutcome = mutation({
  args: {
    orgId: v.id("orgs"),
    bookingId: v.id("bookings"),
    expectedVersion: v.number(),
    outcome: v.union(v.literal("completed"), v.literal("no_show")),
    requestId: v.string(),
  },
  returns: vBookingDoc,
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);
    const requestId = boundedString(args.requestId, "requestId", {
      min: 1,
      max: 100,
    });
    const booking = await loadBookingForWrite(
      ctx,
      args.orgId,
      args.bookingId,
    );
    const prior = await findLeadEventByOperationKey(
      ctx,
      args.orgId,
      `booking:${args.bookingId}:outcome:${requestId}`,
    );
    if (prior !== null) {
      if (booking.state !== args.outcome) {
        throw domainError(
          "CONFLICT",
          `requestId ${requestId} already recorded outcome ${booking.state}`,
        );
      }
      return booking;
    }
    if (booking.state !== "confirmed") {
      throw domainError(
        "CONFLICT",
        `booking is ${booking.state}; only a confirmed meeting can record an outcome`,
      );
    }
    assertExpectedVersion(booking.version, args.expectedVersion, "booking");
    if (
      booking.startsAt === undefined ||
      booking.endsAt === undefined ||
      booking.timezone === undefined
    ) {
      // A confirmed booking carries its agreement — missing fields are a
      // schema violation, not a business case.
      throw invalid("confirmed booking is missing its agreed times");
    }
    const now = Date.now();
    if (now < booking.startsAt) {
      throw domainError(
        "CONFLICT",
        "the meeting has not started yet — an outcome is recorded after the scheduled start",
      );
    }
    const prospect = await loadProspect(
      ctx,
      args.orgId,
      booking.prospectId,
    );
    const inBookingStage = prospect.stage === "meeting_booked";
    const nextStage = inBookingStage
      ? await fallbackLeadStage(ctx, prospect)
      : prospect.stage;
    await ctx.db.patch("bookings", booking._id, {
      state: args.outcome,
      version: booking.version + 1,
      updatedAt: now,
    });
    await ctx.db.patch("prospects", prospect._id, {
      ...(inBookingStage
        ? {
            stage: nextStage,
            stageReason: boundedString(
              `Meeting ${args.outcome === "no_show" ? "no-show" : "completed"}`,
              "stageReason",
              { min: 1, max: PROSPECT_STAGE_REASON_MAX_LENGTH },
            ),
          }
        : {}),
      updatedAt: now,
    });
    await appendLeadEvent(ctx, {
      orgId: args.orgId,
      prospectId: prospect._id,
      kind: "booking_outcome_recorded",
      summary: `Meeting outcome recorded: ${args.outcome}`,
      operationKey: `booking:${booking._id}:outcome:${requestId}`,
      bookingId: booking._id,
      ...(inBookingStage && nextStage !== prospect.stage
        ? { fromStage: prospect.stage, toStage: nextStage }
        : {}),
      actor: { source: "human", identityKey },
      details: {
        reason: args.outcome === "completed" ? "meeting completed" : "no-show",
      },
    });
    const updated = await ctx.db.get("bookings", booking._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "booking not found after patch");
    }
    return updated;
  },
});
