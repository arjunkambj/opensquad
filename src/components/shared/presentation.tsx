import type { ReactNode } from "react"
import type { Doc } from "../../../convex/_generated/dataModel"
import { cn } from "@/lib/utils"

const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
})

/**
 * How long something has waited. Deliberately coarse and deliberately
 * backward looking: these screens never render a countdown or an ETA, because
 * nothing in the backend promises when waiting work will be picked up.
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
 * window and a daily allowance are evaluated there — showing the reader's own
 * zone for a policy boundary would be a different number from the one the
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

/**
 * Pills are hand-rolled spans throughout this codebase (there is no Badge
 * primitive); this one keeps every surface consistent rather than introducing
 * a second style.
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

/** A label/value line used throughout the detail surfaces. */
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

/**
 * Who caused an activity row. `actor` is an identityKey for human actions and
 * a reserved word otherwise; the identityKey itself is never rendered.
 */
export function actorLabel(actor: string): string {
  if (actor === "workflow") {
    return "automation"
  }
  if (actor === "system") {
    return "the system"
  }
  return "a teammate"
}
