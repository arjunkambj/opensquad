import { useUser } from "@hexclave/react"
import { OrgBoundary } from "@/components/auth/OrgBoundary"
import { OnboardingSkeleton } from "@/components/onboarding/OnboardingSkeleton"
import { SetupForActiveOrg } from "@/components/onboarding/SetupForActiveOrg"

export function SetupFlow() {
  const user = useUser({ or: "redirect" })

  return (
    <OrgBoundary
      user={user}
      fallback={<OnboardingSkeleton label="Opening your organization" />}
    >
      {/* Remount on organization changes to discard the previous provisioning attempt. */}
      <SetupForActiveOrg key={user.selectedTeam?.id} user={user} />
    </OrgBoundary>
  )
}
