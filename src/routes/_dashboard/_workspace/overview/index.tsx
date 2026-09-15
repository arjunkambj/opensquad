import { createFileRoute } from "@tanstack/react-router"
import { MissionBoard } from "@/components/missions/MissionBoard"
import { AttentionBlock } from "@/components/overview/AttentionBlock"
import { OverviewDashboard } from "@/components/overview/OverviewDashboard"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * Mission Control itself. The URL contract lives one level up, on
 * `overview.tsx`, so this route and the mission detail beside it share one
 * definition and cannot drift — the same arrangement `decisions.tsx` uses.
 */
export const Route = createFileRoute("/_dashboard/_workspace/overview/")({
  component: OverviewPage,
})

function OverviewPage() {
  const current = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      {/* Still carrying the page title and the date picker for one more
          slice; the receipts feed replaces its placeholder card, and the
          board moves above it, when the feed lands. */}
      <OverviewDashboard />

      {/* `null` cannot reach here — the `_workspace` gate redirects a
          membership-less user to setup — but loading is the only honest
          render for a case that resolves elsewhere. */}
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading what needs you"
          description="Counting everything waiting on a human."
        />
      ) : (
        <AttentionBlock workspaceId={current.workspace._id} />
      )}

      <MissionBoard />
    </div>
  )
}
