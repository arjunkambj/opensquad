import { createFileRoute } from "@tanstack/react-router"
import { OverviewDashboard } from "@/components/overview/OverviewDashboard"

export const Route = createFileRoute("/_dashboard/overview")({
  component: OverviewPage,
})

function OverviewPage() {
  return <OverviewDashboard />
}
