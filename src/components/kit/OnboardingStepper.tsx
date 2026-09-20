/**
 * OnboardingStepper — the row of dots and connecting lines above the
 * onboarding card (refs 01, 04–11).
 *
 * Dots up to and including `current` are done; the rest show their number.
 * The connector *leaving* the current dot fills with `progress`, which is how
 * the stepper moves on every screen instead of only once per stage — the
 * onboarding stages each hold several screens.
 */
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@/lib/utils"

export type OnboardingStepperProps = {
  /** How many dots to draw. */
  count: number
  /** Which dot (1-based) the user is in. */
  current: number
  /** 0–1: how far through the current dot's screens the user is. */
  progress?: number
  /** Accessible name for the list. */
  label: string
  className?: string
}

function Dot({
  index,
  state,
}: {
  index: number
  state: "done" | "current" | "upcoming"
}) {
  const filled = state === "done" || state === "current"
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors",
        filled
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground",
        state === "current" && "ring-4 ring-primary/20",
      )}
    >
      {filled ? (
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

function Connector({ fill }: { fill: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, fill)) * 100)
  return (
    <span
      aria-hidden="true"
      className="mx-1 block h-px w-10 shrink-0 bg-border sm:w-20"
    >
      <span
        className="block h-px bg-foreground transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </span>
  )
}

export function OnboardingStepper({
  count,
  current,
  progress = 0,
  label,
  className,
}: OnboardingStepperProps) {
  const dots = Array.from({ length: Math.max(0, count) }, (_, i) => i + 1)
  return (
    <ol
      aria-label={label}
      className={cn("flex items-center justify-center", className)}
    >
      {dots.map((n) => {
        const state =
          n < current ? "done" : n === current ? "current" : "upcoming"
        const fill = n - 1 < current ? 1 : n - 1 === current ? progress : 0
        return (
          <li
            key={n}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center"
          >
            {n > 1 ? <Connector fill={fill} /> : null}
            <Dot index={n} state={state} />
          </li>
        )
      })}
    </ol>
  )
}
