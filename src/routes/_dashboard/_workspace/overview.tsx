import { createFileRoute } from "@tanstack/react-router"
import { SetupBanner } from "@/components/onboarding/SetupBanner"
import { OverviewDashboard } from "@/components/overview/OverviewDashboard"

export const Route = createFileRoute("/_dashboard/_workspace/overview")({
  component: OverviewPage,
})

function OverviewPage() {
  return (
    <>
      <SetupBanner />
      <OverviewDashboard />
    </>
  )
}
