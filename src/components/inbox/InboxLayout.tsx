import { Outlet, useParams } from "@tanstack/react-router"
import { InboxList } from "@/components/inbox/InboxList"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"

/**
 * List-beside-detail at ≥1280px; below that an open thread replaces the list
 * with a back control (`plan/ux.md` §6). The list stays MOUNTED either way —
 * hiding it is a CSS choice in the parent, not a different route structure,
 * which is also what lets closing a thread return focus to the row that
 * opened it.
 */
export function InboxLayout() {
  const params = useParams({ strict: false })
  const detailOpen = params.conversationId !== undefined

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Inbox"
        description="Every reply your inbox received, and who — you or the agent — owns each thread."
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
