import type { ReactNode } from "react"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"

const ONBOARDING_DOTS = 4
const OUTREACH_DOT = 3
const OUTREACH_SUB_STEPS = 2

export function OutreachStepShell({
  step,
  title,
  description,
  children,
  onPrevious,
  onNext,
  nextLabel,
  nextDisabled,
  nextLoading,
  secondaryAction,
}: {
  /** 1 = connect the inbox, 2 = goals. */
  step: 1 | 2
  title: string
  description: ReactNode
  children: ReactNode
  onPrevious: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  nextLoading?: boolean
  secondaryAction?: ReactNode
}) {
  return (
    <OnboardingShell
      logo={<Logo />}
      dotCount={ONBOARDING_DOTS}
      currentDot={OUTREACH_DOT}
      step={step}
      stepCount={OUTREACH_SUB_STEPS}
      title={title}
      description={description}
      onPrevious={onPrevious}
      onNext={onNext}
      {...(nextLabel !== undefined ? { nextLabel } : {})}
      {...(nextDisabled !== undefined ? { nextDisabled } : {})}
      {...(nextLoading !== undefined ? { nextLoading } : {})}
      {...(secondaryAction !== undefined ? { secondaryAction } : {})}
    >
      {children}
    </OnboardingShell>
  )
}
