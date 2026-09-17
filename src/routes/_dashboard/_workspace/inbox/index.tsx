import { createFileRoute } from "@tanstack/react-router"
import { EmptyState } from "@/components/states/states"

export const Route = createFileRoute("/_dashboard/_workspace/inbox/")({
  component: InboxIndex,
})

/**
 * At ≥1280px the list renders beside this placeholder, so the empty right
 * pane explains itself. Below that the list occupies the page and this
 * renders nothing — the route exists because the layout needs an index child,
 * not because it has its own page.
 */
function InboxIndex() {
  return (
    <div className="hidden xl:block">
      <EmptyState
        title="Pick a thread"
        description="The list on the left is the work — a reply to read, an unmatched message to link, a frozen thread to resume."
      />
    </div>
  )
}
