import type { Doc } from "../../../convex/_generated/dataModel"
import type {
  BoardColumn,
  MissionKind,
  MissionOutcome,
  MissionProspectOutcome,
  MissionState,
  RunState,
} from "../../../convex/lib/validators"
import { Chip } from "@/components/decisions/decision-presentation"

/**
 * Shared vocabulary for the board, the mission cards and the mission detail.
 *
 * Two of the four board columns hold more than one state — Backlog covers
 * `queued`, `paused` and `cancelled`; Needs you covers `waiting_for_user`,
 * `waiting_for_runtime` and `failed`, plus anything `queued` or `active` with
 * an open required ask. A column header therefore cannot tell an operator what
 * a card is, which is why the per-card state chip is mandatory rather than
 * decorative, and why every label here is a **word**. The tint is a second,
 * redundant signal (V10: state meaning must not depend only on colour).
 *
 * `vMissionPriority` has no exported TypeScript type, so priority is read off
 * the document rather than re-declared; the others are imported from the
 * backend union so a new member cannot silently fall through a record here.
 */
export type MissionPriority = Doc<"missions">["priority"]

export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  queued: "Queued",
  active: "Running",
  waiting_for_user: "Waiting on you",
  waiting_for_runtime: "Waiting on the runtime",
  paused: "Paused",
  failed: "Failed",
  completed: "Completed",
  cancelled: "Cancelled",
}

/**
 * One sentence per state, written for someone who has not read the schema.
 * `waiting_for_runtime` must read as a *connection* problem and never as
 * "review a draft", and `failed` must read as a technical error and never as
 * something to approve.
 */
export const MISSION_STATE_SUMMARY: Record<MissionState, string> = {
  queued: "Accepted and waiting to start. Nothing has run yet.",
  active: "Running now.",
  waiting_for_user: "A required ask is open. Nothing moves until someone answers it.",
  waiting_for_runtime:
    "The runtime is not available. This is a connection problem, not something to approve.",
  paused: "Paused by someone here. It resumes only when a person resumes it.",
  failed:
    "It stopped on a technical error. This is not an approval and there is no retry — read the receipt, then archive it.",
  completed: "It finished and produced what it promised.",
  cancelled: "Cancelled by someone here. It is not a completion.",
}

const MISSION_STATE_TONE: Record<MissionState, string> = {
  queued: "bg-muted text-muted-foreground",
  active: "bg-chart-2/15 text-chart-2",
  waiting_for_user: "bg-chart-1/15 text-chart-1",
  waiting_for_runtime: "bg-chart-1/15 text-chart-1",
  paused: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
  completed: "bg-chart-2/15 text-chart-2",
  cancelled: "bg-muted text-muted-foreground",
}

export function MissionStateChip({ state }: { state: MissionState }) {
  return (
    <Chip className={MISSION_STATE_TONE[state]}>
      <span title={MISSION_STATE_SUMMARY[state]}>
        {MISSION_STATE_LABEL[state]}
      </span>
    </Chip>
  )
}

/**
 * Rendered only for `high`. A chip reading "Normal priority" on every card is
 * noise, and its absence is not ambiguous — normal is the default the backend
 * writes when nobody chose.
 */
export function MissionPriorityChip({
  priority,
}: {
  priority: MissionPriority
}) {
  if (priority !== "high") {
    return null
  }
  return <Chip className="bg-chart-1/15 text-chart-1">High priority</Chip>
}

export const MISSION_KIND_LABEL: Record<MissionKind, string> = {
  sales_campaign: "Sales campaign",
  reply: "Reply",
  follow_up: "Follow-up",
}

export function MissionKindChip({ kind }: { kind: MissionKind }) {
  return <Chip>{MISSION_KIND_LABEL[kind]}</Chip>
}

/**
 * The terminal aggregate of the mission's branches. It is a different fact
 * from the state: a `completed` mission can carry a `partial` or
 * `contact_needed` outcome, and saying only "Completed" would overclaim.
 */
export const MISSION_OUTCOME_LABEL: Record<MissionOutcome, string> = {
  completed: "Everything promised was produced",
  partial: "Partial — some branches finished, others did not",
  contact_needed: "Work done, contacts still owed",
  skipped: "Everything was deliberately skipped",
  failed: "Failed",
  cancelled: "Cancelled",
}

export function MissionOutcomeChip({ outcome }: { outcome: MissionOutcome }) {
  return (
    <Chip
      className={
        outcome === "completed"
          ? "bg-chart-2/15 text-chart-2"
          : outcome === "failed"
            ? "bg-destructive/15 text-destructive"
            : "bg-muted text-muted-foreground"
      }
    >
      {MISSION_OUTCOME_LABEL[outcome]}
    </Chip>
  )
}

/** One prospect branch's ending, in words. */
export const PROSPECT_OUTCOME_LABEL: Record<MissionProspectOutcome, string> = {
  completed: "Completed",
  contact_needed: "Contact still needed",
  rejected: "Rejected",
  skipped: "Skipped",
  failed: "Failed",
  cancelled: "Cancelled",
}

/**
 * Run states in words. `uncertain` is its own state on purpose — it means the
 * outcome is unknown, which is neither success nor failure, and collapsing it
 * into either would be the exact lie the state exists to prevent.
 */
export const RUN_STATE_LABEL: Record<RunState, string> = {
  pending: "Pending — not started",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  uncertain: "Uncertain — the outcome is unknown",
}

/**
 * The four columns' copy.
 *
 * A column's subtitle has to cover **every** state the column can hold, or it
 * misdescribes most of the cards under it. Read off `MISSION_STATE_BOARD` and
 * `boardColumnForMission` in `convex/lib/validators.ts`:
 *
 * - Backlog holds `queued`, `paused` and `cancelled`.
 * - Needs you holds `waiting_for_user`, `waiting_for_runtime` and `failed` —
 *   **and** anything `queued` or `active` whose `requiredDecisionCount` is
 *   above zero, which the subtitle has to say or the column looks wrong.
 * - In flight holds `active` with no required ask open.
 * - Done holds `completed`, and only `completed`. `failed` maps to Needs you,
 *   so a failure can never pose as a completion.
 *
 * This is a **label** source only. `boardColumn` is a stored field that three
 * backend writers keep in sync; the UI renders whatever column returned a card
 * and never recomputes its placement.
 */
export const BOARD_COLUMN_META: Record<
  BoardColumn,
  {
    label: string
    subtitle: string
    emptyTitle: string
    emptyDescription: string
  }
> = {
  backlog: {
    label: "Backlog",
    subtitle:
      "Not running: waiting to start, paused by someone here, or cancelled.",
    emptyTitle: "Nothing waiting to start",
    emptyDescription:
      "A confirmed mission waits here before it runs. New mission puts one here.",
  },
  needs_you: {
    label: "Needs you",
    subtitle:
      "Nothing moves until a person acts: an open ask, a runtime to reconnect, or a failure to close out — including missions that are otherwise queued or running.",
    emptyTitle: "Nothing is waiting on you",
    emptyDescription:
      "A mission appears here when the squad needs a decision, when the runtime has to be reconnected, or when something failed and needs closing out.",
  },
  in_flight: {
    label: "In flight",
    subtitle: "Running now, with nothing waiting on you.",
    emptyTitle: "Nothing is running right now",
    emptyDescription:
      "A mission moves here once the runtime picks it up and no required ask is open.",
  },
  done: {
    label: "Done",
    subtitle:
      "Completed. Archiving one hides it from the board without claiming anything about the outcome.",
    emptyTitle: "No mission has completed yet",
    emptyDescription:
      "A mission lands here when it finishes and produces what it promised. A failed mission never reaches this column.",
  },
}
