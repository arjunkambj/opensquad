import { Outlet, useParams } from "@tanstack/react-router"
import { InboxPageSkeleton } from "@/components/inbox/InboxPageSkeleton"
import { ConversationsPanel } from "@/components/inbox/list/ConversationsPanel"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { useCurrentOrg } from "@/hooks/use-current-org"

export function InboxPage() {
  const current = useCurrentOrg()
  const params = useParams({ strict: false })
  const threadOpen = params.conversationId !== undefined

  if (current.status !== "ready") {
    return <InboxPageSkeleton />
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The panes are the page on wide screens; the title only helps where
          the list and thread stack. */}
      <div className="xl:hidden">
        <DashboardPageTitle
          title="Inbox"
          description="Every reply your sending inbox received, and the answer waiting to go back."
        />
      </div>
      {/* Keep the list mounted when the mobile thread view hides it. On wide
          screens both panes run edge to edge and scroll on their own. */}
      <div className="flex min-w-0 flex-col gap-6 xl:-m-8 xl:grid xl:h-[calc(100svh-1rem)] xl:min-h-[34rem] xl:grid-cols-[23rem_minmax(0,1fr)] xl:gap-0 xl:overflow-hidden xl:rounded-2xl">
        <div
          className={
            threadOpen
              ? "hidden min-h-0 min-w-0 xl:flex xl:flex-col xl:border-r xl:border-border"
              : "min-h-0 min-w-0 xl:flex xl:flex-col xl:border-r xl:border-border"
          }
        >
          <ConversationsPanel orgId={current.org._id} />
        </div>
        {/* Below xl the connect prompt leads, since nothing lands in the list
            until the inbox is connected. */}
        <div className="order-first min-h-0 min-w-0 xl:order-none xl:overflow-y-auto xl:px-8 xl:py-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
