import type { ReactNode } from "react"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import {
  ONBOARDING_STAGE_LABELS,
  onboardingStageLabel,
} from "@/components/onboarding/onboarding-stages"
import { FormError } from "@/components/states/states"

const ONBOARDING_DOTS = ONBOARDING_STAGE_LABELS.length
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
  nextHint,
  secondaryAction,
  moveError = null,
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
  nextHint?: ReactNode
  secondaryAction?: ReactNode
  /** Why the container refused the last step change. */
  moveError?: string | null
}) {
  return (
    <OnboardingShell
      logo={<Logo markClassName="size-8" />}
      dotCount={ONBOARDING_DOTS}
      currentDot={OUTREACH_DOT}
      stageLabel={onboardingStageLabel(OUTREACH_DOT)}
      step={step}
      stepCount={OUTREACH_SUB_STEPS}
      title={title}
      description={description}
      onPrevious={onPrevious}
      onNext={onNext}
      {...(nextLabel !== undefined ? { nextLabel } : {})}
      {...(nextDisabled !== undefined ? { nextDisabled } : {})}
      {...(nextLoading !== undefined ? { nextLoading } : {})}
      {...(nextHint !== undefined ? { nextHint } : {})}
      {...(secondaryAction !== undefined ? { secondaryAction } : {})}
    >
      <div className="flex flex-col gap-8">
        {children}
        <FormError message={moveError} />
      </div>
    </OnboardingShell>
  )
}
