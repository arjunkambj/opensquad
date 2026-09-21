import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { FormError } from "@/components/states/states"

export type SignalsStepShellProps = Pick<
  OnboardingStepProps,
  "progress" | "moveError"
> & {
  badge?: ReactNode
  icon?: IconSvgElement
  title: string
  description: ReactNode
  children: ReactNode
  onPrevious?: () => void
  previousDisabled?: boolean
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  nextLoading?: boolean
  secondaryAction?: ReactNode
  error?: string | null
  /** The strip above the footer — the Regenerate control and its price. */
  aside?: ReactNode
}

export function SignalsStepShell({
  progress,
  moveError,
  badge,
  icon,
  title,
  description,
  children,
  onPrevious,
  previousDisabled = false,
  onNext,
  nextLabel,
  nextDisabled = false,
  nextLoading = false,
  secondaryAction,
  error = null,
  aside,
}: SignalsStepShellProps) {
  return (
    <OnboardingShell
      currentDot={progress.dot}
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
      {...(icon === undefined ? {} : { icon })}
      {...(nextLabel === undefined ? {} : { nextLabel })}
      {...(secondaryAction === undefined ? {} : { secondaryAction })}
      {...(onPrevious === undefined ? {} : { onPrevious, previousDisabled })}
    >
      <div className="flex flex-col gap-6">
        {children}
        <FormError message={error ?? moveError} />
        {aside === undefined ? null : (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            {aside}
          </div>
        )}
      </div>
    </OnboardingShell>
  )
}
