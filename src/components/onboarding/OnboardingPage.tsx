import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"

/** Setup: the workspace and what the squad may do, before anything runs. */
export function OnboardingPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Setup"
        description="Configure your workspace and confirm what the squad may do before anything runs."
      />
      <OnboardingWizard />
    </div>
  )
}
