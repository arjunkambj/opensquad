import { addDays, startOfDay, subDays } from "date-fns"

export type CalendarDateRange = {
  start: Date
  end: Date
}

/* ------------------------------------------------------------------ */
/* Civil days in the org's zone                                        */
/* ------------------------------------------------------------------ */

/**
 * Two vocabularies, and the bug that comes of mixing them.
 *
 * A **civil date** is a wall-calendar day — "16 September 2026" — with no
 * instant attached. That is what a range pill selects and what the heading
 * names, and it travels here as a browser-local `Date` at midnight, because
 * that is what date-fns arithmetic speaks.
 *
 * An **instant** is an epoch millisecond, and it is what `activity.list`
 * filters on. Turning a civil day into instants requires a zone, and the zone
 * that matters is the **org's**, not the browser's — every timestamp in
 * the feed is printed with `formatInstant(…, org.timezone)`, and every
 * send allowance in this product is bucketed by `localDayKey(now,
 * org.timezone)`. Deriving the window from the browser instead meant an
 * operator in a different zone read a heading naming one day above rows
 * stamped with another, and missed a whole evening of receipts they would
 * swear had happened.
 *
 * This is the same conversion `localDayParts` / `localCivilToUtc` perform in
 * `convex/lib/validators/shared.ts`, reimplemented rather than imported: they are
 * value exports and importing them would pull the convex module graph into
 * the browser bundle. No timezone database is involved on either side —
 * `Intl` already carries one.
 */
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

/**
 * The instant of 00:00 on `civil` in `timezone`.
 *
 * Guess the civil time as UTC, measure the zone's offset at the guess and
 * correct; converges in two or three iterations. Across a DST gap — a local
 * midnight that never occurs, as in a handful of zones — it lands on the
 * boundary instant, which is right for a range bound. An unreadable zone
 * falls back to the browser's own midnight rather than throwing: a bad
 * timezone string must not take the feed down.
 */
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

/**
 * The last instant of `civil` in `timezone`. `activity.list` treats `to` as an
 * inclusive `lte` bound, so this is the millisecond before the next local
 * midnight — derived from that boundary rather than from "23:59:59.999", which
 * is a different instant on any day the zone shifts.
 */
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

/* ------------------------------------------------------------------ */
/* Range bounds                                                        */
/* ------------------------------------------------------------------ */

export type ActivityRangeId = "today" | "7d" | "30d" | "custom"

/**
 * The bounds to hand `activity.list`, which treats `from`/`to` as inclusive
 * epoch-millisecond range bounds on `createdAt`.
 *
 * `timezone` is the **org's** IANA zone, and the day boundaries are its
 * boundaries: the feed prints every row in that zone, so a window derived
 * from the browser's would name one day and list another's events.
 *
 * `?range=custom` missing either bound is not expressible, so it falls back to
 * the documented default rather than silently listing all of history.
 */
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
