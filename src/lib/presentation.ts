const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
})

/** Elapsed time only: the backend does not promise an ETA for queued work. */
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

/** Use the organization timezone for policy and allowance boundaries. */
export function formatInstant(at: number, timezone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone === undefined ? {} : { timeZone: timezone }),
  }).format(at)
}

/** Human actors are identity keys; never render the key itself. */
export function actorLabel(actor: string): string {
  if (actor === "workflow") {
    return "automation"
  }
  if (actor === "system") {
    return "the system"
  }
  return "a teammate"
}
