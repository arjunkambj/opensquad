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
