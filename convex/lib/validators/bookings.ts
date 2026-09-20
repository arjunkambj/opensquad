/**
 * Booking validators: the booking state machine, which confirmation sources
 * are enabled, the bounds on notes and reasons, and the proposal shape a
 * booking is agreed from.
 */
import { assertEpochMs, assertIanaTimezone, invalid, normalizeHttpUrl } from "./shared";
import { v } from "convex/values";
import type { Infer } from "convex/values";

export const vBookingState = v.union(
  v.literal("proposed"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("no_show"),
);

export type BookingState =
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

/** States that occupy the at-most-one-active slot per lead (§4.3). */
export const BOOKING_ACTIVE_STATES: readonly BookingState[] = [
  "proposed",
  "confirmed",
];

/** States that REQUIRE `startsAt`, `endsAt` and `timezone` (§4.3). */
export const BOOKING_TIMED_STATES: readonly BookingState[] = [
  "confirmed",
  "completed",
  "no_show",
];

/**
 * How a meeting time became authoritative. `manual` is an authenticated
 * human's assertion. `provider` keeps a typed contract but is UNAVAILABLE
 * until a validated calendar connector verifies the event — the same
 * declared-but-gated shape as `ENABLED_SOURCES`; no model may fabricate an
 * external event ID (§4.3, §8 "CRM and booking transitions").
 */
export const vConfirmationSource = v.union(
  v.literal("manual"),
  v.literal("provider"),
);

export type ConfirmationSource = "manual" | "provider";

/** Confirmation sources currently permitted on a write. */
export const ENABLED_CONFIRMATION_SOURCES = ["manual"] as const;

/**
 * Reject a confirmation basis whose verification path does not exist yet.
 * `provider` stays declared but unwritable until a validated calendar
 * connector can supply a real event — §4.3 forbids standing one in for a
 * human assertion, and §8 forbids fabricating external event IDs.
 */
export function assertConfirmationSourceEnabled(
  source: ConfirmationSource,
): void {
  const enabled = new Set<string>(ENABLED_CONFIRMATION_SOURCES);
  if (!enabled.has(source)) {
    throw invalid(
      `confirmationSource ${source} is not available; a validated calendar connector must verify the event first`,
    );
  }
}

export const BOOKING_SLOTS_MAX = 3;

export const BOOKING_CONFIRMATION_NOTE_MAX_LENGTH = 300;

export const BOOKING_CANCELLATION_REASON_MAX_LENGTH = 500;

/**
 * A confirmed meeting longer than this is not a sales call — it is a data
 * error the operator should fix before it is recorded.
 * `assertRequiredBookingTimes` enforces it alongside `endsAt > startsAt`
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

/**
 * Enforce the §4.3 precondition "times required for confirmed/completed/
 * no-show", returning the normalized triple for those states only.
 *
 * NOT a way to derive what to STORE. `undefined` here means "this state does
 * not require times", never "this row has none": a booking cancelled from
 * `confirmed` still carries the agreed start/end/timezone, and §8 "CRM and
 * booking transitions" requires keeping it — writing the triple back as
 * undefined on cancel would destroy the record of what was actually agreed.
 * The row-level timezone is the CONFIRMED meeting's zone; a `slots` proposal's
 * own timezone records what was offered and is not rewritten by a reschedule.
 */
export function assertRequiredBookingTimes(
  state: BookingState,
  times: { startsAt?: number; endsAt?: number; timezone?: string },
  field = "booking",
): { startsAt: number; endsAt: number; timezone: string } | undefined {
  if (!BOOKING_TIMED_STATES.includes(state)) {
    return undefined;
  }
  if (
    times.startsAt === undefined ||
    times.endsAt === undefined ||
    times.timezone === undefined
  ) {
    throw invalid(
      `${field} in state ${state} requires startsAt, endsAt and timezone`,
    );
  }
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
  return {
    startsAt,
    endsAt,
    timezone: assertIanaTimezone(times.timezone, `${field}.timezone`),
  };
}
