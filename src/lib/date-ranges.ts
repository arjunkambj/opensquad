import {
  addDays,
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns"

export const DATE_RANGE_PRESETS = {
  today: { label: "Today" },
  yesterday: { label: "Yesterday" },
  last_7_days: { label: "Last 7 days" },
  last_30_days: { label: "Last 30 days" },
  week_to_date: { label: "Week to date" },
  month_to_date: { label: "Month to date" },
  last_month: { label: "Last month" },
} as const

export type DateRangePreset = keyof typeof DATE_RANGE_PRESETS

export type CalendarDateRange = {
  start: Date
  end: Date
}

/* ------------------------------------------------------------------ */
/* Civil days in the workspace's zone                                  */
/* ------------------------------------------------------------------ */

/**
 * Two vocabularies, and the bug that comes of mixing them.
 *
 * A **civil date** is a wall-calendar day — "16 September 2026" — with no
 * instant attached. That is what the picker selects and what the heading
 * names, and it travels here as a browser-local `Date` at midnight, because
 * that is what `react-day-picker` and date-fns arithmetic both speak.
 *
 * An **instant** is an epoch millisecond, and it is what `activity.list`
 * filters on. Turning a civil day into instants requires a zone, and the zone
 * that matters is the **workspace's**, not the browser's — every timestamp in
 * the feed is printed with `formatInstant(…, workspace.timezone)`, and every
 * send allowance in this product is bucketed by `localDayKey(now,
 * workspace.timezone)`. Deriving the window from the browser instead meant an
 * operator in a different zone read a heading naming one day above rows
 * stamped with another, and missed a whole evening of receipts they would
 * swear had happened.
 *
 * This is the same conversion `localDayParts` / `localCivilToUtc` perform in
 * `convex/lib/validators.ts`, reimplemented rather than imported: they are
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

/**
 * A civil wall-clock time — an input[type=date] plus an input[type=time]
 * value — as a UTC instant in `timezone`, or the reason it cannot be one.
 *
 * The same converging guess `zonedStartOfDayMs` uses, generalised to any
 * minute of day, with the result read BACK through the zone before it is
 * trusted: a civil time inside a spring-forward gap resolves to a different
 * wall time and is reported `impossible_time` rather than silently repaired;
 * a fall-back hour that occurs twice resolves to the earlier instant and is
 * flagged `ambiguous` so the caller can refuse or make the choice explicit
 * (V24: ambiguous and invalid DST times are rejected, never guessed).
 */
export type CivilToUtcResult =
  | { ok: true; ms: number; ambiguous: boolean }
  | { ok: false; reason: "bad_input" | "unreadable_zone" | "impossible_time" }

export function civilTimeToUtcMs(
  date: string,
  time: string,
  timezone: string,
): CivilToUtcResult {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (dateMatch === null || timeMatch === null) {
    return { ok: false, reason: "bad_input" }
  }
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hours = Number(timeMatch[1])
  const minutes = Number(timeMatch[2])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    hours > 23 ||
    minutes > 59 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return { ok: false, reason: "bad_input" }
  }
  const minuteOfDay = hours * 60 + minutes
  const desired = Date.UTC(year, month - 1, day) + minuteOfDay * 60_000

  let guess = desired
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(guess, timezone)
    if (actual === null) {
      return { ok: false, reason: "unreadable_zone" }
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

  // Read the answer back: a gap time converges to an instant that reads as a
  // DIFFERENT wall time in the zone, which is the only honest way to know
  // "14:30" never existed there.
  const back = zonedParts(guess, timezone)
  if (
    back === null ||
    Date.UTC(back.year, back.month - 1, back.day) + back.minuteOfDay * 60_000 !==
      desired
  ) {
    return { ok: false, reason: "impossible_time" }
  }
  // A repeated wall time has two instants reading as it; the repeat sits one
  // offset-step away — 30, 45 or 60 minutes depending on the zone.
  let ambiguous = false
  for (const offset of [1_800_000, 2_700_000, 3_600_000]) {
    for (const candidate of [guess - offset, guess + offset]) {
      const other = zonedParts(candidate, timezone)
      if (
        other !== null &&
        Date.UTC(other.year, other.month - 1, other.day) +
          other.minuteOfDay * 60_000 ===
          desired
      ) {
        ambiguous = true
      }
    }
  }
  return { ok: true, ms: guess, ambiguous }
}

/**
 * The inverse of `civilTimeToUtcMs`: an instant as the `input[type=date]` and
 * `input[type=time]` values a form should prefill with, on the workspace's
 * wall clock. `null` when the zone cannot be read — the form then starts
 * empty rather than prefilling in the wrong zone.
 */
export function civilInputsInZone(
  atMs: number,
  timezone: string,
): { date: string; time: string } | null {
  const parts = zonedParts(atMs, timezone)
  if (parts === null) {
    return null
  }
  const pad = (value: number) => String(value).padStart(2, "0")
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(Math.floor(parts.minuteOfDay / 60))}:${pad(parts.minuteOfDay % 60)}`,
  }
}

/** Today on the workspace's wall calendar — not necessarily the browser's. */
export function todayInZone(timezone: string, now = new Date()): Date {
  return zonedCalendarDay(now.getTime(), timezone)
}

/* ------------------------------------------------------------------ */
/* Due windows — the /leads "Due actions" mode                         */
/* ------------------------------------------------------------------ */

export function getPresetRange(
  preset: DateRangePreset,
  timezone: string,
  now = new Date(),
): CalendarDateRange {
  const currentDate = todayInZone(timezone, now)

  switch (preset) {
    case "today":
      return { start: currentDate, end: currentDate }
    case "yesterday": {
      const yesterday = subDays(currentDate, 1)
      return { start: yesterday, end: yesterday }
    }
    case "last_7_days":
      return { start: subDays(currentDate, 6), end: currentDate }
    case "last_30_days":
      return { start: subDays(currentDate, 29), end: currentDate }
    case "week_to_date":
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: currentDate,
      }
    case "month_to_date":
      return { start: startOfMonth(currentDate), end: currentDate }
    case "last_month": {
      const previousMonth = subMonths(currentDate, 1)
      return {
        start: startOfMonth(previousMonth),
        end: startOfDay(endOfMonth(previousMonth)),
      }
    }
  }
}

/**
 * The two date vocabularies in this app, mapped in one place.
 *
 * The picker speaks `DATE_RANGE_PRESETS` (seven presets, including four the
 * URL cannot name); the URL speaks `ACTIVITY_RANGES` (`today | 7d | 30d |
 * custom`). Without a mapping the picker and the address bar disagree, which
 * is worse than either one being wrong on its own — the operator reads one and
 * shares the other.
 *
 * The rule: a preset the URL can name travels as a **relative** label, so a
 * shared `?range=7d` means the last seven days for whoever opens it. Every
 * other preset, and every hand-picked range, travels as two **absolute**
 * instants, so it means the same window for both people.
 */
export type ActivityRangeId = "today" | "7d" | "30d" | "custom"

const ACTIVITY_RANGE_PRESET = {
  today: "today",
  "7d": "last_7_days",
  "30d": "last_30_days",
} as const satisfies Record<string, DateRangePreset>

/**
 * The bounds to hand `activity.list`, which treats `from`/`to` as inclusive
 * epoch-millisecond range bounds on `createdAt`.
 *
 * `timezone` is the **workspace's** IANA zone, and the day boundaries are its
 * boundaries: the feed prints every row in that zone, so a window derived from
 * the browser's would name one day and list another's events.
 *
 * `?range=custom` missing either bound is not expressible, so it falls back to
 * the documented default rather than silently listing all of history — rule 2
 * of the search-param contract.
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
  const span = getPresetRange(
    range === "custom" ? "today" : ACTIVITY_RANGE_PRESET[range],
    timezone,
    now,
  )
  return {
    from: zonedStartOfDayMs(civilOf(span.start), timezone),
    to: zonedEndOfDayMs(civilOf(span.end), timezone),
  }
}

/** The same range, in the shape the picker renders. */
export function activityRangeToCalendar(
  range: ActivityRangeId,
  from: number | undefined,
  to: number | undefined,
  timezone: string,
  now = new Date(),
): { value: CalendarDateRange; preset: DateRangePreset | null } {
  if (range === "custom") {
    if (from === undefined || to === undefined) {
      return { value: getPresetRange("today", timezone, now), preset: "today" }
    }
    // The stored instants are read back on the workspace's calendar, so a
    // range someone pasted names the same two days for both of them.
    return {
      value: {
        start: zonedCalendarDay(from, timezone),
        end: zonedCalendarDay(to, timezone),
      },
      preset: null,
    }
  }
  const preset = ACTIVITY_RANGE_PRESET[range]
  return { value: getPresetRange(preset, timezone, now), preset }
}

/**
 * What the picker's choice should write into the URL.
 *
 * The four presets `ACTIVITY_RANGES` cannot name — yesterday, week to date,
 * month to date, last month — become absolute custom ranges rather than being
 * dropped. That is what stops the picker showing "Last month" while the URL
 * still says `today`.
 */
export function calendarRangeToSearch(
  value: CalendarDateRange,
  preset: DateRangePreset | null,
  timezone: string,
): { range: ActivityRangeId; from?: number; to?: number } {
  if (preset === "today") {
    return { range: "today" }
  }
  if (preset === "last_7_days") {
    return { range: "7d" }
  }
  if (preset === "last_30_days") {
    return { range: "30d" }
  }
  return {
    range: "custom",
    from: zonedStartOfDayMs(civilOf(value.start), timezone),
    to: zonedEndOfDayMs(civilOf(value.end), timezone),
  }
}
