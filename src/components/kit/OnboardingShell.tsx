/**
 * OnboardingShell — the frame every onboarding screen sits in (refs 01–11).
 *
 * It owns the four things that are identical on every one of those screens:
 * the warm gradient ground, the centred logo, the dot stepper, and the single
 * rounded card with its "Step n of m" counter and Previous / Next footer.
 * Everything inside the card is the caller's.
 *
 * Two independent counters exist on these screens and are deliberately kept
 * apart: `currentDot` is which of the macro stages the user is in (the dots),
 * while `step` / `stepCount` is the sub-step inside that stage (the top-right
 * label). The connector leaving the current dot fills with the sub-step
 * progress, which is what makes the stepper move on every screen rather than
 * only once per stage.
 *
 * Data-free: labels, logo and callbacks all arrive as props.
 */
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
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

function StepperDot({
  index,
  state,
}: {
  index: number
  state: "done" | "current" | "upcoming"
}) {
  const done = state === "done" || state === "current"
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors",
        done
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground",
        state === "current" && "ring-4 ring-primary/20",
      )}
    >
      {done ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2.5}
          className="size-4"
          aria-hidden="true"
        />
      ) : (
        index
      )}
    </span>
  )
}

function StepperConnector({ fill }: { fill: number }) {
  return (
    <span
      aria-hidden="true"
      className="mx-1 block h-px w-10 shrink-0 bg-border sm:w-20"
    >
      <span
        className="block h-px bg-foreground transition-[width] duration-300"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%` }}
      />
    </span>
  )
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
  const dots = Array.from({ length: Math.max(0, dotCount) }, (_, i) => i + 1)
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

      <ol
        aria-label={stepperLabel}
        className="mt-8 flex items-center justify-center"
      >
        {dots.map((n) => {
          const state =
            n < currentDot ? "done" : n === currentDot ? "current" : "upcoming"
          const fill =
            n - 1 < currentDot ? 1 : n - 1 === currentDot ? subProgress : 0
          return (
            <li
              key={n}
              aria-current={state === "current" ? "step" : undefined}
              className="flex items-center"
            >
              {n > 1 ? <StepperConnector fill={fill} /> : null}
              <StepperDot index={n} state={state} />
            </li>
          )
        })}
      </ol>

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
