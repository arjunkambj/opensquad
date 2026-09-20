/**
 * Dot 3's frame: the kit's `OnboardingShell` with this dot's fixed numbers
 * filled in (dot 3 of 4, "Step n of 2").
 *
 * It exists so both sub-steps say the same thing about where they are, and so
 * that lifting the shell into the onboarding page — if the stepper ends up
 * owning it — is one edit rather than two.
 */
import type { ReactNode } from "react"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"

/** The four dots of PLAN §11 M1: company, ICP, outreach, signals. */
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
