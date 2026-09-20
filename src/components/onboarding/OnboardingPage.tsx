import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"

/** Setup: the workspace and what the agent may do, before anything runs. */
export function OnboardingPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Setup"
        description="Tell us about your company and what your agent should do before anything runs."
      />
      <OnboardingWizard />
    </div>
  )
}
