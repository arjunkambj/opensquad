/**
 * Timezone and sending-window helpers shared by onboarding and settings.
 * Weekday integers follow the backend contract: 0 = Sunday … 6 = Saturday.
 */

export const WEEKDAYS: readonly { value: number; short: string; long: string }[] =
  [
    { value: 0, short: "Sun", long: "Sunday" },
    { value: 1, short: "Mon", long: "Monday" },
    { value: 2, short: "Tue", long: "Tuesday" },
    { value: 3, short: "Wed", long: "Wednesday" },
    { value: 4, short: "Thu", long: "Thursday" },
    { value: 5, short: "Fri", long: "Friday" },
    { value: 6, short: "Sat", long: "Saturday" },
  ]

/** "HH:MM" (24h, input[type=time] value) → minutes after local midnight. */
export function timeStringToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) {
    return undefined
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return undefined
  }
  return hours * 60 + minutes
}

/** Minutes after local midnight → "HH:MM" for input[type=time]. */
export function minutesToTimeString(minutes: number): string {
  const clamped = Math.min(Math.max(Math.trunc(minutes), 0), 1439)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`
}

/** The browser's best guess for the local IANA timezone. */
export function detectLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

const FALLBACK_TIMEZONES: readonly string[] = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
]

/**
 * Selectable IANA timezone options. Uses the runtime's full database when
 * `Intl.supportedValuesOf` exists, else a curated common-zone fallback. The
 * `extra` value (e.g. a stored zone) is always present so a saved value never
 * disappears from the picker.
 */
export function timezoneOptions(extra?: string): string[] {
  let zones: readonly string[] = FALLBACK_TIMEZONES
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      zones = Intl.supportedValuesOf("timeZone")
    }
  } catch {
    zones = FALLBACK_TIMEZONES
  }
  const options = [...zones]
  if (extra !== undefined && extra !== "" && !options.includes(extra)) {
    options.push(extra)
    options.sort()
  }
  return options
}
