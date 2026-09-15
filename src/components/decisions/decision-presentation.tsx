import type { ReactNode } from "react"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type {
  DecisionKind,
  DecisionState,
} from "../../../convex/lib/validators"
import { cn } from "@/lib/utils"

/**
 * What every kind panel is handed. `expectedVersion` is the version the
 * reviewer saw, not the live one; `actionNotice` is the sentence that replaces
 * the action group when the reviewer may not act (read-only role, or the ask
 * moved underneath them) — never a disabled button with no explanation.
 */
export type DecisionPanelProps = {
  workspaceId: Id<"workspaces">
  decision: Doc<"decisions">
  expectedVersion: number
  canAct: boolean
  actionNotice: ReactNode | null
}

/**
 * Shared vocabulary for the decision queue and the decision detail.
 *
 * The four kinds are four genuinely different asks, so they never share one
 * generic label: a reviewer who reads "Decision" learns nothing, and the whole
 * value of this screen is that the reviewer knows what they are agreeing to
 * before they agree to it. Every string here is written for someone who has
 * not read the schema.
 */

export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  draft_approval: "Approve an email",
  missing_information: "Answer a question",
  connection_required: "Connect something",
  delivery_uncertain: "Delivery unknown",
}

/** One line naming what the human is actually being asked to do. */
export const DECISION_KIND_SUMMARY: Record<DecisionKind, string> = {
  draft_approval:
    "Read the exact recipient, subject and body, then approve, request changes or reject.",
  missing_information:
    "The squad is waiting on facts it cannot find on its own.",
  connection_required:
    "Work is blocked until a connection is in place.",
  delivery_uncertain:
    "A send request may or may not have reached the provider. No local action can tell.",
}

export const DECISION_STATE_LABEL: Record<DecisionState, string> = {
  open: "Open",
  resolved: "Resolved",
  superseded: "Superseded",
  cancelled: "Cancelled",
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
})

/**
 * How long an ask has waited. Deliberately coarse and deliberately backward
 * looking: this screen never renders a countdown or an ETA, because nothing in
 * the backend promises when a waiting ask will be answered.
 */
export function formatWaited(since: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000)
  if (minutes < 1) {
    return "just now"
  }
  if (minutes < 60) {
    return RELATIVE_TIME.format(-minutes, "minute")
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return RELATIVE_TIME.format(-hours, "hour")
  }
  return RELATIVE_TIME.format(-Math.floor(hours / 24), "day")
}

/**
 * An absolute instant. `timezone` is the workspace's IANA zone, because a send
 * window and a daily allowance are evaluated there — showing the reviewer's
 * own zone for a policy boundary would be a different number from the one the
 * backend will use.
 */
export function formatInstant(at: number, timezone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone === undefined ? {} : { timeZone: timezone }),
  }).format(at)
}

/** A short fingerprint of a payload hash — enough to compare two by eye. */
export function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-8)}`
}

/** Turn a `requestedFields` key into a label without losing the key itself. */
export function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim()
  if (spaced.length === 0) {
    return key
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Pills are hand-rolled spans throughout this codebase (there is no Badge
 * primitive); these two keep the decision surfaces consistent with the
 * employee and runtime cards rather than introducing a new one.
 */
export function Chip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function KindChip({ kind }: { kind: DecisionKind }) {
  return <Chip>{DECISION_KIND_LABEL[kind]}</Chip>
}

/**
 * State is carried by the word, never by colour alone (V10) — the colour is a
 * second, redundant signal.
 */
export function StateChip({ state }: { state: DecisionState }) {
  return (
    <Chip
      className={
        state === "open"
          ? "bg-chart-2/15 text-chart-2"
          : "bg-muted text-muted-foreground"
      }
    >
      {DECISION_STATE_LABEL[state]}
    </Chip>
  )
}

/** Required asks hold their mission in Needs you; say so rather than imply it. */
export function RequiredChip({ required }: { required: boolean }) {
  return (
    <Chip className={required ? "bg-chart-1/15 text-chart-1" : undefined}>
      {required ? "Required" : "Optional"}
    </Chip>
  )
}

/**
 * Permission-denied is not empty: it says the thing exists, you cannot change
 * it, and here is who can. Rendered instead of the action group — never as a
 * disabled button whose reason the user has to guess.
 */
export function RoleNote({ action }: { action: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      You have read-only access to this workspace. An owner or operator can{" "}
      {action}.
    </p>
  )
}

/** A label/value line used throughout the decision detail. */
export function DetailRow({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-sm text-foreground">
        {value}
      </span>
    </div>
  )
}

/**
 * Attempt states in words. `acknowledged` reads as "Sent" — the provider
 * accepted it — and never as "Delivered", which is a fact no attempt row
 * asserts. Every state is legible without colour (V10).
 */
export function attemptStateLabel(state: Doc<"sendAttempts">["state"]): string {
  switch (state) {
    case "reserved":
      return "Reserved — waiting for its turn, nothing sent"
    case "requesting":
      return "Requesting — handed to the provider, no result yet"
    case "acknowledged":
      return "Sent — the provider accepted it"
    case "uncertain":
      return "Delivery uncertain — the outcome is unknown"
    case "definitively_failed":
      return "Definitely unsent — it never reached the provider"
    case "cancelled":
      return "Cancelled before it was sent"
  }
}
