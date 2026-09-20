import type {
  BookingProposal,
  BookingState,
} from "../../../convex/lib/validators"
import { Chip, formatInstant } from "@/components/shared/presentation"

/**
 * Booking vocabulary — `/leads/$prospectId` Booking tab.
 *
 * "Proposed" is deliberately worded as NOT agreed: a sent link, an offered
 * slot and a classified reply are all proposals, and none of them is a
 * confirmed meeting (the state machine refuses to let one become one).
 */
export const BOOKING_STATE_LABEL: Record<BookingState, string> = {
  proposed: "Proposed — not yet agreed",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
}

export const ACTIVE_BOOKING_STATES: readonly BookingState[] = [
  "proposed",
  "confirmed",
]

export function BookingStateChip({ state }: { state: BookingState }) {
  return (
    <Chip
      className={
        state === "confirmed"
          ? "bg-chart-2/15 text-chart-2"
          : state === "proposed"
            ? "bg-chart-4/15 text-chart-4"
            : state === "no_show" || state === "cancelled"
              ? "bg-chart-1/15 text-chart-1"
              : undefined
      }
    >
      {BOOKING_STATE_LABEL[state]}
    </Chip>
  )
}

/**
 * What was OFFERED, in words — never "booked". A link is a link and a slot
 * list is a slot list; neither implies a picked time exists.
 */
export function proposalSummary(
  proposal: BookingProposal,
  timezone: string,
): string {
  if (proposal.kind === "booking_link") {
    return `Offered a booking link (${new URL(proposal.url).host})`
  }
  const first = proposal.slots[0]
  return (
    `Offered ${proposal.slots.length} time` +
    `${proposal.slots.length === 1 ? "" : "s"} in ${proposal.timezone}` +
    (first === undefined
      ? ""
      : ` — earliest ${formatInstant(first.startsAt, timezone)}`)
  )
}
