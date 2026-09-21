/**
 * Presentation helpers used by more than one component domain: relative and
 * absolute times and the small typed projections around them.
 *
 * Pure and data-free — no JSX, nothing here calls Convex or knows which
 * screen renders it.
 */
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
 * An absolute instant. `timezone` is the org's IANA zone, because a send
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
