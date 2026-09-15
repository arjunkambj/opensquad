import { createFileRoute } from "@tanstack/react-router"
import { OverviewDashboard } from "@/components/overview/OverviewDashboard"

/**
 * Mission Control itself. The URL contract lives one level up, on
 * `overview.tsx`, so this route and the mission detail beside it share one
 * definition and cannot drift — the same arrangement `decisions.tsx` uses.
 */
export const Route = createFileRoute("/_dashboard/_workspace/overview/")({
  component: OverviewPage,
})

function OverviewPage() {
  return <OverviewDashboard />
}
