import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { ActivityFeed } from "@/components/overview/ActivityFeed"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * Overview. The page is deliberately thin while the outbound agent is being
 * rebuilt: the dated receipt feed is the one thing it can answer honestly
 * today. The "what needs a person" strip lives on `/leads` — the signed-in
 * home — not here; the date picker belongs to the activity section and to
 * nothing above it.
 */
export function OverviewPage() {
  const current = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Overview"
        description="What the workspace has done, and everything that is waiting on a person."
      />

      {/* `null` cannot reach here — the `_workspace` gate redirects a
          membership-less user to setup — but loading is the only honest
          render for a case that resolves elsewhere. */}
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading overview"
          description="Reading your workspace."
        />
      ) : (
        <ActivityFeed
          workspaceId={current.workspace._id}
          timezone={current.workspace.timezone}
        />
      )}
    </div>
  )
}
