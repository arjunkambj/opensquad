import { Outlet, useParams } from "@tanstack/react-router"
import { ConversationsPanel } from "@/components/inbox/list/ConversationsPanel"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"

export function InboxPage() {
  const current = useCurrentOrg()
  const params = useParams({ strict: false })
  const threadOpen = params.conversationId !== undefined

  if (current.status !== "ready") {
    return (
      <div className="flex flex-col gap-6">
        <DashboardPageTitle title="Inbox" />
        <LoadingState
          title="Loading your inbox"
          description="Reading this organization's conversations."
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
      {/* Keep the list mounted when the mobile thread view hides it. */}
      <div className="flex min-w-0 flex-col gap-6 xl:grid xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
        <div className={threadOpen ? "hidden min-w-0 xl:block" : "min-w-0"}>
          <ConversationsPanel orgId={current.org._id} />
        </div>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
