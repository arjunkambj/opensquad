import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * Gate for every page that cannot do anything before setup is finished.
 *
 * Two conditions, in order (PLAN §5): a workspace, and an agent whose
 * `onboardingStep` is `done`. Either missing means the only honest
 * destination is `/onboarding` — the stepper resumes at the saved step, so
 * the redirect never costs the user work.
 *
 * Pathless, so it adds no URL segment — `/dashboard` stays `/dashboard`.
 *
 * `onboarding` and `settings` stay OUTSIDE it deliberately: setup cannot be
 * gated by the thing setup creates, and account access must survive having no
 * workspace.
 *
 * The redirect lives here rather than in `beforeLoad` because the router is
 * created without context (`src/main.tsx`), so no Convex client is reachable
 * from a route loader. Reading the queries in the component is the available
 * mechanism, not a preference.
 */
export const Route = createFileRoute("/_dashboard/_workspace")({
  component: WorkspaceGate,
})

function WorkspaceGate() {
  const current = useCurrentWorkspace()
  const workspaceId =
    current !== undefined && current !== null
      ? current.workspace._id
      : undefined
  // Skipped until the workspace resolves: the agent is workspace-scoped and
  // the query would have nothing to read.
  const agent = useQuery(
    api.agents.queries.get,
    workspaceId === undefined ? "skip" : { workspaceId },
  )

  if (current === undefined) {
    return (
      <LoadingState
        title="Loading organization"
        description="Checking your organization membership."
      />
    )
  }

  // `null` is "signed in, but holding no active membership" — the only honest
  // destination is setup. `replace` so Back does not bounce between the two.
  if (current === null) {
    return <Navigate to="/onboarding" replace />
  }

  if (agent === undefined) {
    return (
      <LoadingState
        title="Loading your agent"
        description="Checking how far setup got."
      />
    )
  }

  // No agent at all is the pre-onboarding state, not an error.
  if (agent === null || agent.onboardingStep !== "done") {
    return <Navigate to="/onboarding" replace />
  }

  return <Outlet />
}
