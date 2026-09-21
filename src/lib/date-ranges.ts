import { addDays, startOfDay, subDays } from "date-fns"

export type CalendarDateRange = {
  start: Date
  end: Date
}

/** Calendar Dates represent civil days; query bounds are instants in the organization timezone.
 * Keep this conversion client-side to avoid importing the Convex runtime into the bundle. */
type CivilDate = { year: number; month: number; day: number }

type ZonedParts = CivilDate & { minuteOfDay: number }

/** What `atMs` reads as on the wall clock in `timezone`, or null if it cannot be read. */
function zonedParts(atMs: number, timezone: string): ZonedParts | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(atMs))
  } catch {
    return null
  }
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN)
  const year = read("year")
  const month = read("month")
  const day = read("day")
  const hour = read("hour")
  const minute = read("minute")
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null
  }
  return { year, month, day, minuteOfDay: hour * 60 + minute }
}

/** The civil day a browser-local calendar `Date` stands for. */
function civilOf(date: Date): CivilDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

/** A civil day as the browser-local midnight `Date` the calendar renders. */
function localDateOf(civil: CivilDate): Date {
  return new Date(civil.year, civil.month - 1, civil.day)
}

/** Resolve local midnight by correcting a UTC guess with the zone offset.
 * For a DST gap use the boundary instant; an invalid zone falls back to browser-local midnight. */
function zonedStartOfDayMs(civil: CivilDate, timezone: string): number {
  const desired = Date.UTC(civil.year, civil.month - 1, civil.day)
  let guess = desired
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(guess, timezone)
    if (actual === null) {
      return localDateOf(civil).getTime()
    }
    const actualMs =
      Date.UTC(actual.year, actual.month - 1, actual.day) +
      actual.minuteOfDay * 60_000
    const diff = desired - actualMs
    if (diff === 0) {
      break
    }
    guess += diff
  }
  return guess
}

/** The inclusive upper bound is one millisecond before the next local midnight, including DST changes. */
function zonedEndOfDayMs(civil: CivilDate, timezone: string): number {
  const next = civilOf(addDays(localDateOf(civil), 1))
  return zonedStartOfDayMs(next, timezone) - 1
}

/** The civil day `atMs` falls on in `timezone`, as a calendar `Date`. */
function zonedCalendarDay(atMs: number, timezone: string): Date {
  const parts = zonedParts(atMs, timezone)
  return parts === null
    ? startOfDay(new Date(atMs))
    : localDateOf({ year: parts.year, month: parts.month, day: parts.day })
}

/** Today on the org's wall calendar — not necessarily the browser's. */
export function todayInZone(timezone: string, now = new Date()): Date {
  return zonedCalendarDay(now.getTime(), timezone)
}

export type ActivityRangeId = "today" | "7d" | "30d" | "custom"

/** Bounds are inclusive epoch milliseconds in the organization timezone.
 * An incomplete custom range falls back to the default. */
export function activityRangeToBounds(
  range: ActivityRangeId,
  from: number | undefined,
  to: number | undefined,
  timezone: string,
  now = new Date(),
): { from: number; to: number } {
  if (range === "custom" && from !== undefined && to !== undefined) {
    return { from, to }
  }
  const today = todayInZone(timezone, now)
  const daysBack = range === "7d" ? 6 : range === "30d" ? 29 : 0
  return {
    from: zonedStartOfDayMs(civilOf(subDays(today, daysBack)), timezone),
    to: zonedEndOfDayMs(civilOf(today), timezone),
  }
}

/** The instants a picked pair of civil days covers, in `timezone`. */
export function calendarRangeToBounds(
  value: CalendarDateRange,
  timezone: string,
): { from: number; to: number } {
  return {
    from: zonedStartOfDayMs(civilOf(value.start), timezone),
    to: zonedEndOfDayMs(civilOf(value.end), timezone),
  }
}
