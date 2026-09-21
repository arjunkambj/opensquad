import type { ReactNode } from "react"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import { onboardingStageLabel } from "@/components/onboarding/onboarding-stages"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { FormError } from "@/components/states/states"

export type SignalsStepShellProps = Pick<
  OnboardingStepProps,
  "progress" | "moveError"
> & {
  badge?: ReactNode
  title: string
  description: ReactNode
  children: ReactNode
  onPrevious?: () => void
  previousDisabled?: boolean
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  nextLoading?: boolean
  nextHint?: ReactNode
  secondaryAction?: ReactNode
  error?: string | null
  /** Controls under the content — the Regenerate button. */
  aside?: ReactNode
}

export function SignalsStepShell({
  progress,
  moveError,
  badge,
  title,
  description,
  children,
  onPrevious,
  previousDisabled = false,
  onNext,
  nextLabel,
  nextDisabled = false,
  nextLoading = false,
  nextHint,
  secondaryAction,
  error = null,
  aside,
}: SignalsStepShellProps) {
  return (
    <OnboardingShell
      currentDot={progress.dot}
      stageLabel={onboardingStageLabel(progress.dot)}
      description={description}
      dotCount={progress.dotCount}
      logo={<Logo markClassName="size-8" />}
      nextDisabled={nextDisabled}
      nextLoading={nextLoading}
      onNext={onNext}
      step={progress.step}
      stepCount={progress.stepCount}
      stepperLabel="Setup progress"
      title={title}
      {...(badge === undefined ? {} : { badge })}
      {...(nextLabel === undefined ? {} : { nextLabel })}
      {...(nextHint === undefined ? {} : { nextHint })}
      {...(secondaryAction === undefined ? {} : { secondaryAction })}
      {...(onPrevious === undefined ? {} : { onPrevious, previousDisabled })}
    >
      <div className="flex flex-col gap-8">
        {children}
        <FormError message={error ?? moveError} />
        {aside === undefined ? null : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {aside}
          </div>
        )}
      </div>
    </OnboardingShell>
  )
}
