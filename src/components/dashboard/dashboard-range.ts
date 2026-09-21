/** Resolve day boundaries in the organization timezone and keep them stable within the day.
 * Custom pills store absolute bounds; today, 7d and 30d are relative to when the link opens. */
import { addDays, startOfMonth, subMonths } from "date-fns"
import {
  activityRangeToBounds,
  calendarRangeToBounds,
  todayInZone,
  type CalendarDateRange,
} from "@/lib/date-ranges"
import {
  DASHBOARD_DEFAULTS,
  type DashboardSearch,
} from "@/routes/_dashboard/_org/overview"

export const DASHBOARD_RANGE_PILLS = ["today", "7d", "30d", "3m", "mtd"] as const

export type DashboardRangePill = (typeof DASHBOARD_RANGE_PILLS)[number]

export const DASHBOARD_RANGE_LABEL: Record<DashboardRangePill, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "3m": "3 months",
  mtd: "This month",
}

const DASHBOARD_RANGE_HINT: Record<DashboardRangePill, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  mtd: "This month",
}

function pillCalendar(
  pill: DashboardRangePill,
  timezone: string,
  now: Date,
): CalendarDateRange {
  const today = todayInZone(timezone, now)
  switch (pill) {
    case "today":
      return { start: today, end: today }
    case "7d":
      return { start: addDays(today, -6), end: today }
    case "30d":
      return { start: addDays(today, -29), end: today }
    case "3m":
      // Inclusive of today, so the first day is the day AFTER the same date
      // three months back — three months of days, not three months and one.
      return { start: addDays(subMonths(today, 3), 1), end: today }
    case "mtd":
      return { start: startOfMonth(today), end: today }
  }
}

function pillSearch(
  pill: DashboardRangePill,
  timezone: string,
  now = new Date(),
): Pick<DashboardSearch, "range" | "from" | "to"> {
  if (pill === "today" || pill === "7d" || pill === "30d") {
    return { range: pill, from: undefined, to: undefined }
  }
  return {
    range: "custom",
    ...calendarRangeToBounds(pillCalendar(pill, timezone, now), timezone),
  }
}

/** Omit the default range from the URL so bare dashboard links remain valid. */
export function pillFilters(
  pill: DashboardRangePill,
  timezone: string,
  now = new Date(),
): Pick<DashboardSearch, "range" | "from" | "to"> {
  const chosen = pillSearch(pill, timezone, now)
  return {
    range: chosen.range === DASHBOARD_DEFAULTS.range ? undefined : chosen.range,
    from: chosen.from,
    to: chosen.to,
  }
}

function pillBounds(
  pill: DashboardRangePill,
  timezone: string,
  now = new Date(),
): { from: number; to: number } {
  const search = pillSearch(pill, timezone, now)
  return activityRangeToBounds(
    search.range ?? DASHBOARD_DEFAULTS.range,
    search.from,
    search.to,
    timezone,
    now,
  )
}

export function searchBounds(
  search: DashboardSearch,
  timezone: string,
  now = new Date(),
): { from: number; to: number } {
  return activityRangeToBounds(
    search.range ?? DASHBOARD_DEFAULTS.range,
    search.from,
    search.to,
    timezone,
    now,
  )
}

/** Compare resolved bounds so an equivalent custom range selects the same pill. */
export function activePill(
  search: DashboardSearch,
  timezone: string,
  now = new Date(),
): DashboardRangePill | null {
  const bounds = searchBounds(search, timezone, now)
  return (
    DASHBOARD_RANGE_PILLS.find((pill) => {
      const candidate = pillBounds(pill, timezone, now)
      return candidate.from === bounds.from && candidate.to === bounds.to
    }) ?? null
  )
}

/** Format UTC bounds in the organization timezone to name the days the queries count. */
export function windowHint(
  pill: DashboardRangePill | null,
  bounds: { from: number; to: number },
  timezone: string,
): string {
  if (pill !== null) {
    return DASHBOARD_RANGE_HINT[pill]
  }
  const dateFormatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `${dateFormatter.format(new Date(bounds.from))} – ${dateFormatter.format(new Date(bounds.to))}`
}
