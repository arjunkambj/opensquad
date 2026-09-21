/**
 * The frame every pre-step state of setup sits in, so setup never changes
 * shape while it works out which screen the user belongs on.
 *
 * Presentational: it knows the title, the dots and the logo, and nothing
 * about organizations, agents or what went wrong.
 */
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
