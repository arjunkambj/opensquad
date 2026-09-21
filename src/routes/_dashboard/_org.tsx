import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"

/**
 * Gate for every page that cannot do anything before setup is finished.
 *
 * Two conditions, in order (PLAN §5): an org row for the organization active
 * in the auth provider, and an agent whose `onboardingStep` is `done`. Either
 * missing means the only honest destination is `/onboarding` — the stepper
 * resumes at the saved step, so the redirect never costs the user work. That
 * is also what makes switching organization safe: one entered for the first
 * time has neither, and lands in setup rather than on an empty dashboard.
 *
 * Pathless, so it adds no URL segment — `/dashboard` stays `/dashboard`.
 *
 * `onboarding` and `settings` stay OUTSIDE it deliberately: setup cannot be
 * gated by the thing setup creates, and Settings → Account must survive
 * having no organization row — it is where someone with nothing set up reads
 * their own identity and signs out. `/settings` is not therefore ungated:
 * `SettingsPage` applies these same two conditions to every org-scoped tab,
 * so the only thing reachable before setup finishes is Account.
 *
 * The redirect lives here rather than in `beforeLoad` because the router is
 * created without context (`src/main.tsx`), so no Convex client is reachable
 * from a route loader. Reading the queries in the component is the available
 * mechanism, not a preference.
 */
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
