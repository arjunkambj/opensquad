import { createFileRoute } from "@tanstack/react-router"
import { MissionBoard } from "@/components/missions/MissionBoard"
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
  return (
    <div className="flex flex-col gap-6">
      {/* Still carrying the page title and the date picker for one more
          slice; the receipts feed replaces its placeholder card, and the
          board moves above it, when the feed lands. */}
      <OverviewDashboard />
      <MissionBoard />
    </div>
  )
}
