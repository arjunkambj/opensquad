import { createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { DecisionQueue } from "@/components/decisions/DecisionQueue"

export const Route = createFileRoute("/_dashboard/_workspace/decisions/")({
  component: DecisionsPage,
})

function DecisionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Decisions"
        description="Everything the squad cannot decide on its own. Nothing leaves the building until someone here says so."
      />
      <DecisionQueue />
    </div>
  )
}
