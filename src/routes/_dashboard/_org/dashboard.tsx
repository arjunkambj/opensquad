import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "@/components/dashboard/DashboardPage"
import {
  optionalCursor,
  optionalEpochMs,
  optionalOneOf,
} from "@/lib/search-params"

/**
 * The windows the dashboard's range pills can name. `7d` and `30d` are
 * relative labels a pasted link re-derives for whoever opens it; "3 months"
 * and "This month" cannot be named relatively without changing meaning, so
 * they travel as `custom` plus two absolute instants — the same rule the rest
 * of the app's date ranges follow (`src/lib/date-ranges.ts`).
 */
const ACTIVITY_RANGES = ["today", "7d", "30d", "custom"] as const

type ActivityRange = (typeof ACTIVITY_RANGES)[number]

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
 * range someone pasted to a colleague to talk about. They bound every figure
 * on the page — the stat cards, the chart and both panels read the same
 * window, so the screen never mixes two.
 *
 * `cursor` belongs to the receipt feed at the foot of the page alone.
 */
export type DashboardSearch = {
  range?: ActivityRange
  from?: number
  to?: number
  cursor?: string
}

/**
 * Thirty days, as in the reference. A dashboard opening on "today" would
 * answer every figure with a zero on any morning before the agent's first
 * run — a true number that reads as a result, which is exactly the shape of
 * lie the empty states exist to avoid.
 */
export const DASHBOARD_DEFAULTS = {
  range: "30d",
} as const satisfies Required<Pick<DashboardSearch, "range">>

/**
 * The dashboard's URL contract. Filters live here, in the route, rather than
 * in component state, so a reload or a pasted link reopens the same window.
 */
export const Route = createFileRoute("/_dashboard/_org/dashboard")({
  validateSearch: (search): DashboardSearch => ({
    range: optionalOneOf(ACTIVITY_RANGES, search.range),
    from: optionalEpochMs(search.from),
    to: optionalEpochMs(search.to),
    cursor: optionalCursor(search.cursor),
  }),
  component: DashboardPage,
})
