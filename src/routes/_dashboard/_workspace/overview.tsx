import { Outlet, createFileRoute } from "@tanstack/react-router"
import { SetupBanner } from "@/components/onboarding/SetupBanner"
import {
  optionalCursor,
  optionalEpochMs,
  optionalOneOf,
  optionalText,
} from "@/lib/search-params"

/** Receipt windows for the activity feed, not for unfinished work. */
export const ACTIVITY_RANGES = ["today", "7d", "30d", "custom"] as const

export type ActivityRange = (typeof ACTIVITY_RANGES)[number]

/**
 * Every member is optional, and a value equal to its default is written as
 * `undefined` so it never reaches the URL. Two consequences, both wanted: the
 * clean state of the page is the bare `/overview`, and a `<Link to="/overview">`
 * does not have to spell out a search object — which it would if any member
 * were required, at every link in the app.
 *
 * Read them through `overviewDefaults` rather than defaulting at each use site.
 *
 * `from`/`to` are absolute epoch-millisecond instants and belong to
 * `?range=custom` alone: a relative label like `7d` means the last seven days
 * for whoever opens the link, which is right for a window and wrong for a
 * range someone pasted to a colleague to talk about. They bound the activity
 * feed only.
 */
export type OverviewSearch = {
  campaign?: string
  range?: ActivityRange
  from?: number
  to?: number
  cursor?: string
}

export const OVERVIEW_DEFAULTS = {
  range: "today",
} as const satisfies Required<Pick<OverviewSearch, "range">>

/** The search with defaults applied — total, for rendering. */
export function overviewDefaults(search: OverviewSearch) {
  return {
    ...search,
    range: search.range ?? OVERVIEW_DEFAULTS.range,
  }
}

/**
 * Overview's URL contract. §10 requires the page to be reloadable with its
 * filters intact, which follows from the filters living here, in the parent
 * route, rather than in component state.
 *
 * This file is the LAYOUT: `/overview` itself renders through
 * `overview/index.tsx`. A child reads the search with
 * `useSearch({ from: "/_dashboard/_workspace/overview" })` — the id of whoever
 * declared `validateSearch`, never the child's own id.
 */
export const Route = createFileRoute("/_dashboard/_workspace/overview")({
  validateSearch: (search): OverviewSearch => ({
    campaign: optionalText(search.campaign),
    range: optionalOneOf(ACTIVITY_RANGES, search.range),
    from: optionalEpochMs(search.from),
    to: optionalEpochMs(search.to),
    cursor: optionalCursor(search.cursor),
  }),
  component: OverviewLayout,
})

/**
 * The setup banner belongs to the layout rather than the page body, so an
 * unfinished onboarding stays on screen wherever the operator is looking.
 */
function OverviewLayout() {
  return (
    <>
      <SetupBanner />
      <Outlet />
    </>
  )
}
