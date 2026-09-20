/**
 * The dashboard's four range pills (reference 20), expressed in the URL
 * contract the route already declares.
 *
 * Two of them — 7 days and 30 days — are relative labels `?range=` can name,
 * so a pasted link means "the last seven days" for whoever opens it. The
 * other two cannot be named relatively without lying about what they mean, so
 * they travel as absolute `from`/`to` instants, exactly as
 * `calendarRangeToSearch` does for every other preset the URL cannot spell.
 *
 * Every boundary is derived in the ORG's zone, never the browser's: the
 * numbers on this screen are counted in the org's days, so the window
 * that asks for them has to be cut on the same clock. Every function here is
 * day-granular, which is also what keeps the query arguments stable between
 * renders — an instant recomputed per render would re-subscribe every frame.
 */
import { addDays, startOfMonth, subMonths } from "date-fns"
import {
  activityRangeToBounds,
  calendarRangeToSearch,
  todayInZone,
  type CalendarDateRange,
} from "@/lib/date-ranges"
import {
  DASHBOARD_DEFAULTS,
  type DashboardSearch,
} from "@/routes/_dashboard/_org/dashboard"

export const DASHBOARD_RANGE_PILLS = ["7d", "30d", "3m", "mtd"] as const

export type DashboardRangePill = (typeof DASHBOARD_RANGE_PILLS)[number]

/** The pill's own label. */
export const DASHBOARD_RANGE_LABEL: Record<DashboardRangePill, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "3m": "3 months",
  mtd: "This month",
}

/** The same window as the line under a figure reads. */
export const DASHBOARD_RANGE_HINT: Record<DashboardRangePill, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  mtd: "This month",
}

/** The civil days a pill covers, on the org's calendar. */
function pillCalendar(
  pill: DashboardRangePill,
  timezone: string,
  now: Date,
): CalendarDateRange {
  const today = todayInZone(timezone, now)
  switch (pill) {
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

/** What clicking a pill writes into the URL. */
export function pillSearch(
  pill: DashboardRangePill,
  timezone: string,
  now = new Date(),
): Pick<DashboardSearch, "range" | "from" | "to"> {
  if (pill === "7d" || pill === "30d") {
    return { range: pill, from: undefined, to: undefined }
  }
  const chosen = calendarRangeToSearch(
    pillCalendar(pill, timezone, now),
    null,
    timezone,
  )
  return { range: chosen.range, from: chosen.from, to: chosen.to }
}

/**
 * The same choice in the shape `withFilters` writes to the URL: the default
 * window travels as an ABSENT `range`, so the clean state of the page is the
 * bare `/dashboard` and a `<Link to="/dashboard">` needs no search object.
 */
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

/** The instants a pill stands for — the arguments the queries take. */
export function pillBounds(
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

/** The window the current URL asks for. */
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

/**
 * The pill the current URL matches, or `null` for a window none of them
 * names. Compared on the resolved instants rather than on the raw params, so
 * `?range=30d` and the absolute range covering the same thirty days both
 * light the same pill.
 */
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

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

/**
 * The window in words — the pill's own hint when it is one of the four, and
 * the two dates otherwise.
 *
 * Takes the already-resolved pill and bounds rather than re-deriving them:
 * every derivation here walks `Intl` several times, and the page needs the
 * same answer in half a dozen places on one render.
 *
 * No `timeZone` option on the formatter, deliberately. The instants were
 * derived from civil days in the org's zone and are read back the same
 * way by `activityRangeToBounds`, so putting them through a zone again would
 * shift the label off the days that were actually counted.
 */
export function windowHint(
  pill: DashboardRangePill | null,
  bounds: { from: number; to: number },
): string {
  if (pill !== null) {
    return DASHBOARD_RANGE_HINT[pill]
  }
  return `${dateFormatter.format(new Date(bounds.from))} – ${dateFormatter.format(new Date(bounds.to))}`
}
