import { createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"

export const Route = createFileRoute("/_dashboard/onboarding")({
  component: OnboardingPage,
})

function OnboardingPage() {
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
