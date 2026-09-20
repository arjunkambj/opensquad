/**
 * Inbox — the conversation list beside one thread (reference 24).
 *
 * The page container owns the workspace read and the frame; the list panel
 * owns the list query and the URL contract behind it, and the reading pane is
 * the router's `Outlet` so a thread keeps its own address.
 *
 * On the sidebar: reference 24 shows the shell collapsed to its icon rail.
 * That collapse is the viewer's own preference — `DashboardShell` holds it in
 * `localStorage` and every screen shares it — so forcing the rail from this
 * route would silently rewrite the choice for the rest of the app. The
 * control stays with the user (the collapse button in the sidebar); the
 * hand-off notes what a per-route rail would need from the layout.
 */
import { Outlet, useParams } from "@tanstack/react-router"
import { ConversationsPanel } from "@/components/inbox/list/ConversationsPanel"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

export function InboxPage() {
  const current = useCurrentWorkspace()
  const params = useParams({ strict: false })
  const threadOpen = params.conversationId !== undefined

  if (current === undefined || current === null) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardPageTitle title="Inbox" />
        <LoadingState
          title="Loading your inbox"
          description="Reading this workspace's conversations."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Inbox"
        description="Every reply your sending inbox received, and the answer waiting to go back."
      />
      {/* List beside thread from 1280px up; below that an open thread takes
          the page and carries its own way back. The list stays mounted
          either way — hiding it is a CSS choice here, not a second route. */}
      <div className="flex min-w-0 flex-col gap-6 xl:grid xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
        <div className={threadOpen ? "hidden min-w-0 xl:block" : "min-w-0"}>
          <ConversationsPanel workspaceId={current.workspace._id} />
        </div>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
