import { Outlet, createFileRoute } from "@tanstack/react-router"
import { optionalCursor, optionalText } from "@/lib/search-params"

/**
 * The decision queue's URL contract, declared on the layout so the queue and
 * the detail share one definition and cannot drift. The detail route inherits
 * both params without restating them, which is what makes "back to the queue"
 * return to the same filter and the same page rather than to page one of an
 * unfiltered list.
 *
 * Only two params exist, and the absences are deliberate:
 *
 * - **No kind filter.** `decisions.listOpen` has no kind argument, so a kind
 *   control could only filter the rows this page happened to return — it would
 *   report "2 approvals" on a queue holding thirty. A control the query cannot
 *   honour is a lie, and this is the screen where a lie costs the most.
 * - **No resolved/history toggle.** `listOpen` pins `state: "open"` in its
 *   handler and no workspace-wide resolved query exists at all.
 *
 * Both need a backend change (`plan/ux.md` §2 contract addition (b)) before
 * they can honestly appear.
 */
export type DecisionsSearch = {
  mission?: string
  cursor?: string
}

export const Route = createFileRoute("/_dashboard/_workspace/decisions")({
  validateSearch: (search): DecisionsSearch => ({
    mission: optionalText(search.mission),
    cursor: optionalCursor(search.cursor),
  }),
  component: DecisionsLayout,
})

function DecisionsLayout() {
  return <Outlet />
}
