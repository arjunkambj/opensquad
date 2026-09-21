import { createFileRoute } from "@tanstack/react-router"
import { DashboardPage } from "@/components/dashboard/DashboardPage"
import {
  optionalCursor,
  optionalEpochMs,
  optionalOneOf,
} from "@/lib/search-params"

/** Relative ranges resolve when opened; custom ranges preserve absolute bounds in shared links. */
const ACTIVITY_RANGES = ["today", "7d", "30d", "custom"] as const

type ActivityRange = (typeof ACTIVITY_RANGES)[number]

/** Omit default search values to keep bare links valid. Custom bounds are absolute milliseconds;
 * relative ranges are resolved on opening. The cursor belongs only to the activity feed. */
export type DashboardSearch = {
  range?: ActivityRange
  from?: number
  to?: number
  cursor?: string
}

export const DASHBOARD_DEFAULTS = {
  range: "30d",
} as const satisfies Required<Pick<DashboardSearch, "range">>

export const Route = createFileRoute("/_dashboard/_org/dashboard")({
  validateSearch: (search): DashboardSearch => ({
    range: optionalOneOf(ACTIVITY_RANGES, search.range),
    from: optionalEpochMs(search.from),
    to: optionalEpochMs(search.to),
    cursor: optionalCursor(search.cursor),
  }),
  component: DashboardPage,
})
