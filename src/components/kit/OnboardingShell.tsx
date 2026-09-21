/** currentDot is the macro stage; step/stepCount tracks progress within that stage. */
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
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
  /** Sits to the left of Next — "Connect later", "No keywords needed". */
  secondaryAction?: ReactNode
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
  secondaryAction,
  stepperLabel = "Progress",
  className,
}: OnboardingShellProps) {
  const subProgress =
    step !== undefined && stepCount !== undefined && stepCount > 0
      ? (step - 1) / stepCount
      : 0
  const hasFooter = onPrevious !== undefined || onNext !== undefined

  return (
    <div
      className={cn(
        "flex min-h-svh w-full flex-col items-center bg-linear-to-br from-background via-background to-primary/25 px-4 py-10 sm:px-6",
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

      <section className="mt-10 w-full max-w-3xl rounded-[min(var(--radius-5xl),32px)] bg-card px-6 py-8 shadow-xl shadow-foreground/5 sm:px-10 sm:py-10">
        <div className="flex min-h-6 items-start justify-between gap-4">
          <div className="min-w-0">{badge}</div>
          {step !== undefined && stepCount !== undefined ? (
            <p className="shrink-0 text-xs text-muted-foreground">
              Step {step} of {stepCount}
            </p>
          ) : null}
        </div>

        <header className="flex flex-col items-center gap-2 text-center">
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

        <div className="mt-8">{children}</div>

        {hasFooter ? (
          <footer className="mt-8 flex items-center justify-between gap-4 border-t border-border pt-5">
            <div>
              {onPrevious ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="cta"
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
                <Button
                  type="button"
                  size="cta"
                  disabled={nextDisabled || nextLoading}
                  onClick={onNext}
                >
                  {nextLabel}
                  {nextLoading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      data-icon="inline-end"
                      aria-hidden="true"
                    />
                  )}
                </Button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  )
}
