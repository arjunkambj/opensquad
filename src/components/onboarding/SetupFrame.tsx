import type { ReactNode } from "react"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import { ONBOARDING_DOT_COUNT } from "@/components/onboarding/onboarding-model"

export function SetupFrame({ children }: { children: ReactNode }) {
  return (
    <OnboardingShell
      currentDot={1}
      description="Four short steps, and your agent starts finding leads."
      dotCount={ONBOARDING_DOT_COUNT}
      logo={<Logo markClassName="size-8" />}
      stepperLabel="Setup progress"
      title="Set up your agent"
    >
      {children}
    </OnboardingShell>
  )
}
