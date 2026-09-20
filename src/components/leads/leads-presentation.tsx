import type { ReactNode } from "react"
import type { Doc } from "../../../convex/_generated/dataModel"
import type {
  LeadEventActor,
  LeadEventKind,
  NextAction,
  NextActionKind,
  Qualification,
  SalesStage,
} from "../../../convex/lib/validators"
import { Chip, formatInstant } from "@/components/shared/presentation"

/**
 * Shared vocabulary for the CRM — `/leads` and `/leads/$prospectId`.
 *
 * Same rule as the decision and inbox vocabularies: every state is a word,
 * never a colour alone (V10). The strings are written for an operator, not
 * for the schema — `contact_needed` reads "Contact needed", not a lifecycle
 * enum name.
 */

export const SALES_STAGE_LABEL: Record<SalesStage, string> = {
  discovered: "Discovered",
  researched: "Researched",
  qualified: "Qualified",
  contact_needed: "Contact needed",
  draft_ready: "Draft ready",
  contacted: "Contacted",
  replied: "Replied",
  booking_proposed: "Booking proposed",
  booked: "Booked",
  won: "Won",
  lost: "Lost",
}

export const QUALIFICATION_LABEL: Record<Qualification, string> = {
  pending: "Not yet assessed",
  qualified: "Qualified",
  rejected: "Not a fit",
  needs_review: "Needs review",
}

export const NEXT_ACTION_KIND_LABEL: Record<NextActionKind, string> = {
  follow_up_email: "Follow-up email",
  call: "Call",
  await_reply: "Await reply",
  research: "Research",
  enrich_contact: "Enrich contact",
  propose_booking: "Propose a booking",
  confirm_booking: "Confirm a booking",
  attend_meeting: "Attend the meeting",
  review: "Review",
}

export const LEAD_EVENT_KIND_LABEL: Record<LeadEventKind, string> = {
  stage_changed: "Stage changed",
  owner_assigned: "Owner assigned",
  note_added: "Note",
  next_action_set: "Next action set",
  next_action_cleared: "Next action cleared",
  research_applied: "Research applied",
  contact_enriched: "Contact enriched",
  send_accepted: "Email sent and accepted",
  reply_received: "Reply received",
  booking_proposed: "Booking proposed",
  booking_confirmed: "Booking confirmed",
  booking_rescheduled: "Booking rescheduled",
  booking_cancelled: "Booking cancelled",
  booking_outcome_recorded: "Meeting outcome recorded",
}

/**
 * The stage, legible without colour: the word is the state, the tint is only
 * a redundant second signal. `won`/`lost` get the accent treatment because
 * they are the two terminal calls a human makes — everything else stays
 * neutral.
 */
export function StageChip({ stage }: { stage: SalesStage }) {
  return (
    <Chip
      className={
        stage === "won"
          ? "bg-chart-2/15 text-chart-2"
          : stage === "lost"
            ? "bg-chart-1/15 text-chart-1"
            : stage === "booked"
              ? "bg-chart-2/15 text-chart-2"
              : undefined
      }
    >
      {SALES_STAGE_LABEL[stage]}
    </Chip>
  )
}

export function QualificationChip({
  qualification,
}: {
  qualification: Qualification
}) {
  return (
    <Chip
      className={
        qualification === "qualified"
          ? "bg-chart-2/15 text-chart-2"
          : qualification === "rejected"
            ? "bg-chart-1/15 text-chart-1"
            : undefined
      }
    >
      {QUALIFICATION_LABEL[qualification]}
    </Chip>
  )
}

/** An identityKey (`iss|sub`) rendered for a human: the stable subject tail. */
export function memberLabel(identityKey: string): string {
  const tail = identityKey.split("|").pop()
  return tail === undefined || tail === "" ? identityKey : tail
}

/**
 * A lead's next action as one honest phrase. The absent due time is
 * "unscheduled", an explicit state — never a far-future date and never
 * silently treated as "nothing to do": a lead can carry an undated action.
 */
export function nextActionLabel(
  nextAction: NextAction | undefined,
  nextActionDueAt: number | undefined,
  timezone: string,
  now = Date.now(),
): { text: ReactNode; overdue: boolean } {
  if (nextAction === undefined) {
    return { text: "No next action set", overdue: false }
  }
  const head = `${NEXT_ACTION_KIND_LABEL[nextAction.kind]} — ${nextAction.description}`
  if (nextActionDueAt === undefined) {
    return { text: `${head} · unscheduled`, overdue: false }
  }
  if (nextActionDueAt <= now) {
    return {
      text: `${head} · overdue since ${formatInstant(nextActionDueAt, timezone)}`,
      overdue: true,
    }
  }
  return {
    text: `${head} · due ${formatInstant(nextActionDueAt, timezone)}`,
    overdue: false,
  }
}

/**
 * Who caused a lead event. `human` carries an `identityKey` from auth;
 * `workflow` is the pipeline; `system` is a backend sweep — three different
 * provenances, three different words.
 */
export function leadEventActorLabel(actor: LeadEventActor): string {
  switch (actor.source) {
    case "human":
      return `a person (${memberLabel(actor.identityKey)})`
    case "workflow":
      return "the squad"
    case "system":
      return "the system"
  }
}

/** A prospect doc as `prospects.list`/`search`/`getDetail` return it. */
export type LeadDoc = Doc<"prospects">
