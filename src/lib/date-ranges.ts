import {
  endOfDay,
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

export function getPresetRange(
  preset: DateRangePreset,
  now = new Date(),
): CalendarDateRange {
  const currentDate = startOfDay(now)

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
 * `?range=custom` missing either bound is not expressible, so it falls back to
 * the documented default rather than silently listing all of history — rule 2
 * of the search-param contract.
 */
export function activityRangeToBounds(
  range: ActivityRangeId,
  from: number | undefined,
  to: number | undefined,
  now = new Date(),
): { from: number; to: number } {
  if (range === "custom" && from !== undefined && to !== undefined) {
    return { from, to }
  }
  const span = getPresetRange(
    range === "custom" ? "today" : ACTIVITY_RANGE_PRESET[range],
    now,
  )
  return { from: span.start.getTime(), to: endOfDay(span.end).getTime() }
}

/** The same range, in the shape the picker renders. */
export function activityRangeToCalendar(
  range: ActivityRangeId,
  from: number | undefined,
  to: number | undefined,
  now = new Date(),
): { value: CalendarDateRange; preset: DateRangePreset | null } {
  if (range === "custom") {
    if (from === undefined || to === undefined) {
      return { value: getPresetRange("today", now), preset: "today" }
    }
    return {
      value: { start: startOfDay(new Date(from)), end: startOfDay(new Date(to)) },
      preset: null,
    }
  }
  const preset = ACTIVITY_RANGE_PRESET[range]
  return { value: getPresetRange(preset, now), preset }
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
    from: startOfDay(value.start).getTime(),
    to: endOfDay(value.end).getTime(),
  }
}
