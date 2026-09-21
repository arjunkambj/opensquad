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
      {/* Remount on organization changes to discard the previous provisioning attempt. */}
      <SetupForActiveOrg key={user.selectedTeam?.id} user={user} />
    </OrgBoundary>
  )
}
