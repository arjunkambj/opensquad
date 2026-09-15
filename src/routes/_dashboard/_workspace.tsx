import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * Gate for every page that cannot do anything without a workspace.
 *
 * Before this, nothing routed a workspace-less user into setup: sign-in sends
 * everyone to `/overview`, and `/overview`, `/employees` and `/settings` each
 * dead-ended on their own copy of the same "No workspace yet" card. Three
 * identical dead ends and no gate.
 *
 * Pathless, so it adds no URL segment — `/overview` stays `/overview`.
 *
 * `onboarding` and `settings` stay OUTSIDE it deliberately: setup cannot be
 * gated by the thing setup creates, and account access must survive having no
 * workspace. `settings` therefore keeps its own empty state; the other two do
 * not need theirs any more.
 *
 * The redirect lives here rather than in `beforeLoad` because the router is
 * created without context (`src/main.tsx`), so no Convex client is reachable
 * from a route loader. Reading the query in the component is the available
 * mechanism, not a preference.
 */
export const Route = createFileRoute("/_dashboard/_workspace")({
  component: WorkspaceGate,
})

function WorkspaceGate() {
  const current = useCurrentWorkspace()

  if (current === undefined) {
    return (
      <LoadingState
        title="Loading workspace"
        description="Checking your workspace membership."
      />
    )
  }

  // `null` is "signed in, but holding no active membership" — the only honest
  // destination is setup. `replace` so Back does not bounce between the two.
  if (current === null) {
    return <Navigate to="/onboarding" replace />
  }

  return <Outlet />
}
