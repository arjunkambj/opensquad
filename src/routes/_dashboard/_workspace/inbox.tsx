import { Outlet, createFileRoute, useParams } from "@tanstack/react-router"
import { InboxList } from "@/components/inbox/InboxList"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import {
  oneOf,
  optionalCursor,
  pageSize,
} from "@/lib/search-params"

/**
 * The inbox's URL contract, declared on the layout so the list and the thread
 * share one definition — Back from a thread returns to the same tab and page
 * rather than to page one of `open`.
 *
 * `tab` is one of CONVERSATION_TABS — the only four slices the indexes back
 * (`by_workspaceId_and_state_and_lastMessageAt` and
 * `by_workspaceId_and_humanTakeover_and_lastMessageAt`). There is deliberately
 * no `q`: no inbox search query exists, and a control the backend cannot
 * honour is a lie. `cursor` and `limit` carry paging in the URL because a
 * queue position is shared context (V09/V23).
 */
export type InboxSearch = {
  tab?: "open" | "unassigned" | "takeover" | "closed"
  cursor?: string
  limit?: 25 | 50
}

export const Route = createFileRoute("/_dashboard/_workspace/inbox")({
  validateSearch: (search): InboxSearch => {
    // Defaults are absent from the URL — a clean `/inbox` means the open tab,
    // first page, 25 rows.
    const tab = oneOf(
      ["open", "unassigned", "takeover", "closed"] as const,
      search.tab,
      "open",
    )
    return {
      tab: tab === "open" ? undefined : tab,
      cursor: optionalCursor(search.cursor),
      limit: pageSize(search.limit),
    }
  },
  component: InboxLayout,
})

/**
 * List-beside-detail at ≥1280px; below that an open thread replaces the list
 * with a back control (`plan/ux.md` §6). The list stays MOUNTED either way —
 * hiding it is a CSS choice in the parent, not a different route structure,
 * which is also what lets closing a thread return focus to the row that
 * opened it.
 */
function InboxLayout() {
  const params = useParams({ strict: false })
  const detailOpen = params.conversationId !== undefined

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Inbox"
        description="Every reply the workspace inbox received, and who — person or squad — owns each thread. Nothing is sent from here."
      />
      <div className="flex min-w-0 flex-col gap-6 xl:grid xl:grid-cols-[24rem_minmax(0,1fr)] xl:items-start">
        <div className={detailOpen ? "hidden min-w-0 xl:block" : "min-w-0"}>
          <InboxList detailOpen={detailOpen} />
        </div>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
