/** currentDot is the macro stage; step/stepCount tracks progress within that stage. */
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { Hint } from "@/components/kit/Hint"
import { OnboardingStepper } from "@/components/kit/OnboardingStepper"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type OnboardingShellProps = {
  /** Centred brand mark above the stepper. */
  logo: ReactNode
  /** How many dots the stepper shows. */
  dotCount: number
  /** Which dot (1-based) the user is in. Earlier dots render as done. */
  currentDot: number
  /** Sub-step inside the current dot, 1-based. */
  step?: number
  /** How many sub-steps the current dot has. */
  stepCount?: number
  /** The stage's name, shown above the title with the sub-step count. */
  stageLabel?: string
  /** Top-left slot inside the card, for `AiGeneratedBadge`. */
  badge?: ReactNode
  /** Optional icon tile above the title (ref 11). */
  icon?: IconSvgElement
  title: string
  description?: ReactNode
  children: ReactNode
  onPrevious?: () => void
  previousLabel?: string
  previousDisabled?: boolean
  onNext?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  nextLoading?: boolean
  /** Tooltip on Next — why it is off, when it is. */
  nextHint?: ReactNode
  /** Sits to the left of Next — "Connect later", "No keywords needed". */
  secondaryAction?: ReactNode
  /** Right-hand column on wide screens; stacks above the footer on narrow ones. */
  aside?: ReactNode
  /** Accessible name for the stepper list. */
  stepperLabel?: string
  className?: string
}

export function OnboardingShell({
  logo,
  dotCount,
  currentDot,
  step,
  stepCount,
  stageLabel,
  badge,
  icon,
  title,
  description,
  children,
  onPrevious,
  previousLabel = "Previous",
  previousDisabled = false,
  onNext,
  nextLabel = "Next step",
  nextDisabled = false,
  nextLoading = false,
  nextHint,
  secondaryAction,
  aside,
  stepperLabel = "Progress",
  className,
}: OnboardingShellProps) {
  const subProgress =
    step !== undefined && stepCount !== undefined && stepCount > 0
      ? (step - 1) / stepCount
      : 0
  const showStep =
    step !== undefined && stepCount !== undefined && stepCount > 1
  const hasFooter = onPrevious !== undefined || onNext !== undefined

  const heading = (
    <>
      {stageLabel !== undefined || showStep || badge ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {stageLabel !== undefined || showStep ? (
            <p className="text-sm font-medium text-muted-foreground">
              {stageLabel}
              {stageLabel !== undefined && showStep ? " · " : null}
              {showStep ? `${step} of ${stepCount}` : null}
            </p>
          ) : null}
          {badge}
        </div>
      ) : null}

      <header className="flex flex-col items-start gap-2">
        {icon ? (
          <span className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <HugeiconsIcon
              icon={icon}
              strokeWidth={2}
              className="size-5"
              aria-hidden="true"
            />
          </span>
        ) : null}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <div className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </header>
    </>
  )

  const footer = hasFooter ? (
    <footer className="flex items-start justify-between gap-4">
      <div>
        {onPrevious ? (
          <Button
            type="button"
            variant="ghost"
            disabled={previousDisabled}
            onClick={onPrevious}
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              strokeWidth={2}
              data-icon="inline-start"
              aria-hidden="true"
            />
            {previousLabel}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-4">
        {secondaryAction}
        {onNext ? (
          <Hint content={nextHint}>
            <Button
              type="button"
              disabled={nextDisabled || nextLoading}
              onClick={onNext}
            >
              {nextLabel}
              {nextLoading ? (
                <Spinner data-icon="inline-end" />
              ) : (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  data-icon="inline-end"
                  aria-hidden="true"
                />
              )}
            </Button>
          </Hint>
        ) : null}
      </div>
    </footer>
  ) : null

  return (
    <div
      className={cn(
        "flex min-h-svh w-full flex-col items-center bg-linear-to-br from-background via-background to-section-accent/20 px-4 py-10 sm:px-6",
        className,
      )}
    >
      <div className="flex justify-center">{logo}</div>

      <OnboardingStepper
        className="mt-8"
        count={dotCount}
        current={currentDot}
        progress={subProgress}
        label={stepperLabel}
      />

      {aside === undefined ? (
        <section className="mt-12 flex w-full max-w-2xl flex-col gap-8">
          <div>{heading}</div>
          <div className="min-w-0">{children}</div>
          {footer}
        </section>
      ) : (
        <section className="mt-12 grid w-full max-w-6xl gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-20">
          {/* Sticky so Next stays in reach while the longer right column scrolls. */}
          <div className="flex min-w-0 flex-col gap-8 lg:sticky lg:top-10 lg:self-start">
            <div>{heading}</div>
            <div className="min-w-0">{children}</div>
            <div className="max-lg:hidden">{footer}</div>
          </div>
          <aside className="min-w-0">{aside}</aside>
          <div className="lg:hidden">{footer}</div>
        </section>
      )}
    </div>
  )
}
