import { createFileRoute } from "@tanstack/react-router"
import { EmptyState } from "@/components/states/states"

export const Route = createFileRoute("/_dashboard/_workspace/decisions/")({
  component: DecisionsIndex,
})

/**
 * At ≥1280px the queue renders beside this placeholder, so the empty right
 * pane explains itself. Below that the queue occupies the page and this
 * renders nothing — the route exists because the layout needs an index child,
 * not because it has its own page.
 */
function DecisionsIndex() {
  return (
    <div className="hidden xl:block">
      <EmptyState
        title="Pick a decision"
        description="The queue on the left is the work — an email to approve, a question to answer, a connection to restore."
      />
    </div>
  )
}
