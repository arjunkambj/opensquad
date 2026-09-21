import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"

/** Settings stays outside this gate so Account remains accessible before setup.
 * Org-scoped settings tabs apply the gate themselves. Queries run here because the router has no Convex context. */
export const Route = createFileRoute("/_dashboard/_org")({
  component: OrgGate,
})

function OrgGate() {
  const current = useCurrentOrg()
  const orgId = current.status === "ready" ? current.org._id : undefined
  // Skipped until the organization resolves: the agent is org-scoped and the
  // query would have nothing to read.
  const agent = useQuery(
    api.agents.queries.get,
    orgId === undefined ? "skip" : { orgId },
  )

  if (current.status === "loading") {
    return (
      <LoadingState
        title="Loading organization"
        description="Checking which organization you are working in."
      />
    )
  }

  // Signed in with nothing to read here — no active organization, or one that
  // has never entered the app. Setup is the only honest destination and it
  // handles both. `replace` so Back does not bounce between the two.
  if (orgId === undefined) {
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
