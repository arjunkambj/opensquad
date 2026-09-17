import { createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { MissionBoard } from "@/components/missions/MissionBoard"
import { ActivityFeed } from "@/components/overview/ActivityFeed"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * Mission Control itself. The URL contract lives one level up, on
 * `overview.tsx`, so this route and the mission detail beside it share one
 * definition and cannot drift — the same arrangement `decisions.tsx` uses.
 *
 * The order on the page is the order of the operator's questions once the
 * pipeline is known: can anything run at all, what is the state of the work,
 * and only then what already happened. The "what needs a person" strip lives
 * on `/leads` — the signed-in home — not here; the date picker belongs to the
 * activity section and to nothing above it.
 */
export const Route = createFileRoute("/_dashboard/_workspace/overview/")({
  component: OverviewPage,
})

function OverviewPage() {
  const current = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Mission Control"
        description="Every mission the squad is running, and everything that is waiting on a person."
      />

      {/* `null` cannot reach here — the `_workspace` gate redirects a
          membership-less user to setup — but loading is the only honest
          render for a case that resolves elsewhere. */}
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading Mission Control"
          description="Reading your workspace."
        />
      ) : (
        <>
          <MissionBoard />
          <ActivityFeed
            workspaceId={current.workspace._id}
            timezone={current.workspace.timezone}
          />
        </>
      )}
    </div>
  )
}
