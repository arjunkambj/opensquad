import { Outlet, createFileRoute } from "@tanstack/react-router"
import { SetupBanner } from "@/components/onboarding/SetupBanner"
import {
  flag,
  optionalCursor,
  optionalOneOf,
  optionalText,
} from "@/lib/search-params"

/** Board columns, mirroring `vBoardColumn` in convex/lib/validators.ts. */
export const BOARD_COLUMNS = [
  "backlog",
  "needs_you",
  "in_flight",
  "done",
] as const

export type BoardColumn = (typeof BOARD_COLUMNS)[number]

/** Receipt windows for the activity feed, not for unfinished work. */
export const ACTIVITY_RANGES = ["today", "7d", "30d", "custom"] as const

export type ActivityRange = (typeof ACTIVITY_RANGES)[number]

/**
 * Mission detail's tabs, declared here rather than on the detail route so the
 * whole `/overview` subtree has one search declaration. Absent means
 * `summary`; a stale or misspelled value falls back to it rather than throwing,
 * so an old bookmark still opens the mission.
 */
export const MISSION_TABS = [
  "summary",
  "prospects",
  "decisions",
  "receipts",
  "comments",
] as const

export type MissionTab = (typeof MISSION_TABS)[number]

/**
 * Every member is optional, and a value equal to its default is written as
 * `undefined` so it never reaches the URL. Two consequences, both wanted: the
 * clean state of the board is the bare `/overview`, and a `<Link to="/overview">`
 * does not have to spell out a search object — which it would if any member
 * were required, at every link in the app.
 *
 * Read them through `overviewDefaults` rather than defaulting at each use site.
 */
export type OverviewSearch = {
  campaign?: string
  column?: BoardColumn
  archived?: boolean
  range?: ActivityRange
  tab?: MissionTab
  cursor?: string
}

export const OVERVIEW_DEFAULTS = {
  archived: false,
  range: "today",
  tab: "summary",
} as const satisfies Required<
  Pick<OverviewSearch, "archived" | "range" | "tab">
>

/** The search with defaults applied — total, for rendering. */
export function overviewDefaults(search: OverviewSearch) {
  return {
    ...search,
    archived: search.archived ?? OVERVIEW_DEFAULTS.archived,
    range: search.range ?? OVERVIEW_DEFAULTS.range,
    tab: search.tab ?? OVERVIEW_DEFAULTS.tab,
  }
}

/**
 * Mission Control's URL contract, declared before the board is built so P12
 * does not have to retrofit it. §10 requires mission detail to be reloadable
 * and to preserve the board's filters when it closes — both follow from the
 * filters living here, in the parent of the detail route, rather than in
 * component state.
 *
 * `column` is optional because the wide board shows all four at once; it names
 * the single visible column at phone width, where four columns cannot fit.
 *
 * This file is the LAYOUT: `/overview` itself renders through
 * `overview/index.tsx`, and `overview/missions.$missionId.tsx` renders under
 * the same declaration. A child reads the search with
 * `useSearch({ from: "/_dashboard/_workspace/overview" })` — the id of whoever
 * declared `validateSearch`, never the child's own id.
 */
export const Route = createFileRoute("/_dashboard/_workspace/overview")({
  validateSearch: (search): OverviewSearch => ({
    campaign: optionalText(search.campaign),
    column: optionalOneOf(BOARD_COLUMNS, search.column),
    archived: flag(search.archived) ? true : undefined,
    range: optionalOneOf(ACTIVITY_RANGES, search.range),
    tab: optionalOneOf(MISSION_TABS, search.tab),
    cursor: optionalCursor(search.cursor),
  }),
  component: OverviewLayout,
})

/**
 * The setup banner belongs to the layout rather than the board, so it stays on
 * screen while a mission detail is open: an unfinished onboarding is exactly
 * the reason a mission is stuck, and hiding the banner one click deep would
 * hide the fix from the person looking for it.
 */
function OverviewLayout() {
  return (
    <>
      <SetupBanner />
      <Outlet />
    </>
  )
}
