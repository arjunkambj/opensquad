import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "@/components/dashboard/DashboardPage"
import {
  optionalCursor,
  optionalEpochMs,
  optionalOneOf,
} from "@/lib/search-params"

/** Receipt windows for the activity feed, not for unfinished work. */
export const ACTIVITY_RANGES = ["today", "7d", "30d", "custom"] as const

export type ActivityRange = (typeof ACTIVITY_RANGES)[number]

/**
 * Every member is optional, and a value equal to its default is written as
 * `undefined` so it never reaches the URL. Two consequences, both wanted: the
 * clean state of the page is the bare `/dashboard`, and a
 * `<Link to="/dashboard">` does not have to spell out a search object — which
 * it would if any member were required, at every link in the app.
 *
 * Read them through `dashboardDefaults` rather than defaulting at each use
 * site.
 *
 * `from`/`to` are absolute epoch-millisecond instants and belong to
 * `?range=custom` alone: a relative label like `7d` means the last seven days
 * for whoever opens the link, which is right for a window and wrong for a
 * range someone pasted to a colleague to talk about. They bound the activity
 * feed only.
 */
export type DashboardSearch = {
  range?: ActivityRange
  from?: number
  to?: number
  cursor?: string
}

export const DASHBOARD_DEFAULTS = {
  range: "today",
} as const satisfies Required<Pick<DashboardSearch, "range">>

/**
 * The dashboard's URL contract. Filters live here, in the route, rather than
 * in component state, so a reload or a pasted link reopens the same window.
 */
export const Route = createFileRoute("/_dashboard/_workspace/dashboard")({
  validateSearch: (search): DashboardSearch => ({
    range: optionalOneOf(ACTIVITY_RANGES, search.range),
    from: optionalEpochMs(search.from),
    to: optionalEpochMs(search.to),
    cursor: optionalCursor(search.cursor),
  }),
  component: DashboardPage,
})
