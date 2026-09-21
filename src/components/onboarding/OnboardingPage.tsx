/**
 * Setup — the full-screen four-dot flow (PLAN §5, §11 M1, references 01–11).
 *
 * The page itself is only the way in: it holds the boundary the session
 * suspends against, and everything else lives in the containers below it —
 * `SetupFlow` (signed in, in an organization), `SetupForActiveOrg` (the org
 * row exists, or why it could not), and `AgentSetupFlow` (which screen the
 * agent row says the user is on, and where setup ends).
 */
import { Suspense } from "react"
import { SetupFlow } from "@/components/onboarding/SetupFlow"
import { SetupFrame } from "@/components/onboarding/SetupFrame"
import { LoadingState } from "@/components/states/states"

export function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <SetupFrame>
          <LoadingState
            description="One moment while we check your account."
            title="Opening setup"
          />
        </SetupFrame>
      }
    >
      <SetupFlow />
    </Suspense>
  )
}
