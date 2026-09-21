/**
 * The way into setup: a signed-in user, in an organization.
 *
 * Suspends until the session resolves and bounces a signed-out visitor to
 * sign-in — setup is not a public page — then hands over to the container
 * that makes sure the org row exists.
 */
import { useUser } from "@hexclave/react"
import { OrgBoundary } from "@/components/auth/OrgBoundary"
import { SetupForActiveOrg } from "@/components/onboarding/SetupForActiveOrg"
import { SetupFrame } from "@/components/onboarding/SetupFrame"
import { LoadingState } from "@/components/states/states"

export function SetupFlow() {
  const user = useUser({ or: "redirect" })

  return (
    <OrgBoundary
      user={user}
      fallback={
        <SetupFrame>
          <LoadingState
            description="Opening the organization your agent runs in."
            title="Just a moment"
          />
        </SetupFrame>
      }
    >
      {/* Keyed by the organization: switching one must start setup over
          rather than carry the previous one's "already asked for a row". */}
      <SetupForActiveOrg key={user.selectedTeam?.id} user={user} />
    </OrgBoundary>
  )
}
