/**
 * Booking validators: proposals, manual confirmation and agreed times.
 */
import { assertEpochMs, assertIanaTimezone, invalid, normalizeHttpUrl } from "./shared";
import { v } from "convex/values";
import type { Infer } from "convex/values";

export const vBookingState = v.union(
  v.literal("proposed"),
  v.literal("confirmed"),
);

/** An authenticated human records the agreed meeting. */
export const vConfirmationSource = v.literal("manual");

export const BOOKING_SLOTS_MAX = 3;

export const BOOKING_CONFIRMATION_NOTE_MAX_LENGTH = 300;

/**
 * A confirmed meeting longer than this is not a sales call — it is a data
 * error the operator should fix before it is recorded.
 * `assertAgreedBookingTimes` enforces it alongside `endsAt > startsAt`
 * ("invalid duration", V24).
 */
export const BOOKING_DURATION_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * `bookings.proposal` (§4.3): a booking link, or up to three future intervals
 * under one IANA timezone. A proposal implies NO confirmation — neither a sent
 * link nor an offered slot nor a model classification confirms a meeting.
 */
export const vBookingProposal = v.union(
  v.object({ kind: v.literal("booking_link"), url: v.string() }),
  v.object({
    kind: v.literal("slots"),
    timezone: v.string(),
    slots: v.array(v.object({ startsAt: v.number(), endsAt: v.number() })),
  }),
);

export type BookingProposal = Infer<typeof vBookingProposal>;

/**
 * Validate a proposal at proposal time: a public http(s) link, or 1–3 valid
 * future intervals under a canonical IANA zone. Returns the normalized value.
 */
export function assertBookingProposal(
  proposal: BookingProposal,
  options: { now: number },
  field = "proposal",
): BookingProposal {
  if (proposal.kind === "booking_link") {
    return {
      kind: "booking_link",
      url: normalizeHttpUrl(proposal.url, `${field}.url`),
    };
  }
  if (proposal.slots.length === 0) {
    throw invalid(`${field}.slots must offer at least one interval`);
  }
  if (proposal.slots.length > BOOKING_SLOTS_MAX) {
    throw invalid(
      `${field}.slots allows at most ${BOOKING_SLOTS_MAX} intervals`,
    );
  }
  return {
    kind: "slots",
    timezone: assertIanaTimezone(proposal.timezone, `${field}.timezone`),
    slots: proposal.slots.map((slot, index) => {
      const at = `${field}.slots[${index}]`;
      const startsAt = assertEpochMs(slot.startsAt, `${at}.startsAt`);
      const endsAt = assertEpochMs(slot.endsAt, `${at}.endsAt`);
      if (endsAt <= startsAt) {
        throw invalid(`${at}.endsAt must be after startsAt`);
      }
      if (endsAt - startsAt > BOOKING_DURATION_MAX_MS) {
        throw invalid(
          `${at} duration exceeds ${BOOKING_DURATION_MAX_MS / 3_600_000} hours`,
        );
      }
      if (startsAt <= options.now) {
        throw invalid(`${at}.startsAt must be in the future`);
      }
      return { startsAt, endsAt };
    }),
  };
}

/** Validate and normalize the start, end and timezone of an agreed meeting. */
export function assertAgreedBookingTimes(
  times: { startsAt: number; endsAt: number; timezone: string },
  now: number,
  field = "booking",
): { startsAt: number; endsAt: number; timezone: string } {
  const startsAt = assertEpochMs(times.startsAt, `${field}.startsAt`);
  const endsAt = assertEpochMs(times.endsAt, `${field}.endsAt`);
  if (endsAt <= startsAt) {
    throw invalid(`${field}.endsAt must be after startsAt`);
  }
  if (endsAt - startsAt > BOOKING_DURATION_MAX_MS) {
    throw invalid(
      `${field} duration exceeds ${BOOKING_DURATION_MAX_MS / 3_600_000} hours`,
    );
  }
  if (endsAt <= now) {
    throw invalid("the agreed meeting must not have ended");
  }
  return {
    startsAt,
    endsAt,
    timezone: assertIanaTimezone(times.timezone, `${field}.timezone`),
  };
}
