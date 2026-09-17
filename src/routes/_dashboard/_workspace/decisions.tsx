import {
  Outlet,
  createFileRoute,
  useParams,
} from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { DecisionQueue } from "@/components/decisions/DecisionQueue"
import { optionalCursor, optionalId } from "@/lib/search-params"

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
    mission: optionalId(search.mission),
    cursor: optionalCursor(search.cursor),
  }),
  component: DecisionsLayout,
})

/**
 * List-beside-detail at ≥1280px; below that an open decision replaces the
 * queue with a back control (`plan/ux.md` §6). The queue stays MOUNTED either
 * way — hiding is a CSS decision, not a route change — which is what lets
 * closing a detail return focus to the row that opened it, and what keeps a
 * mid-page cursor position intact.
 */
function DecisionsLayout() {
  const params = useParams({ strict: false })
  const detailOpen = params.decisionId !== undefined

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Decisions"
        description="Everything the squad cannot decide on its own. Nothing leaves the building until someone here says so."
      />
      <div className="flex min-w-0 flex-col gap-6 xl:grid xl:grid-cols-[24rem_minmax(0,1fr)] xl:items-start">
        <div className={detailOpen ? "hidden min-w-0 xl:block" : "min-w-0"}>
          <DecisionQueue detailOpen={detailOpen} />
        </div>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
