import { Suspense } from "react"
import { OnboardingSkeleton } from "@/components/onboarding/OnboardingSkeleton"
import { SetupFlow } from "@/components/onboarding/SetupFlow"

export function OnboardingPage() {
  return (
    <Suspense fallback={<OnboardingSkeleton label="Opening setup" />}>
      <SetupFlow />
    </Suspense>
  )
}
