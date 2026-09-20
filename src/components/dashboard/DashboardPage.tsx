import { useUser } from "@hexclave/react"
import { ActivityFeed } from "@/components/dashboard/ActivityFeed"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/** The greeting of reference 20 — the user's own name, or nobody's. */
function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0]
  return first === undefined || first.length === 0 ? null : first
}

/**
 * `/dashboard` — what the agent has done, and what is waiting on a person.
 *
 * Thin while the funnel is being rebuilt: the dated receipt feed is the one
 * thing it can answer honestly today. T42 adds the status chips, range pills,
 * stat cards, chart and the hot-leads and replies panels of reference 20.
 */
export function DashboardPage() {
  const user = useUser()
  const current = useCurrentWorkspace()
  const name = firstName(user?.displayName ?? null)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title={name === null ? "Welcome back" : `Welcome back, ${name}`}
        description="Your agent works in the background. Here is what it has done."
      />

      {/* `null` cannot reach here — the `_workspace` gate redirects a
          membership-less user to setup — but loading is the only honest
          render for a case that resolves elsewhere. */}
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading dashboard"
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
