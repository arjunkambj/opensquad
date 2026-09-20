/**
 * FlameScore — the 1–3 flame AI score in the Contacts table (ref 23) and the
 * hot-leads list (ref 20).
 *
 * A score exists only on a researched lead (PLAN §7), so the four research
 * states are the props: an unresearched or failed lead gets words, not three
 * empty flames that would read as "scored zero". The score is never colour
 * alone — the accessible name always spells it out.
 */
import { Fire02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type FlameScoreProps = (
  | { status: "researched"; score: 1 | 2 | 3 }
  | { status: "not_researched" | "researching" | "failed" }
) & {
  /** Words for the states that have no score. */
  notResearchedLabel?: string
  researchingLabel?: string
  failedLabel?: string
  /** Builds the accessible name for a scored lead. */
  scoreLabel?: (score: 1 | 2 | 3) => string
  className?: string
}

export function FlameScore(props: FlameScoreProps) {
  const {
    notResearchedLabel = "Not researched yet",
    researchingLabel = "Researching",
    failedLabel = "Research failed",
    scoreLabel = (score) => `AI score ${score} of 3`,
    className,
  } = props

  if (props.status === "researching") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <Spinner className="size-3.5" />
        {researchingLabel}
      </span>
    )
  }

  if (props.status !== "researched") {
    return (
      <span
        className={cn(
          "inline-flex items-center text-xs",
          props.status === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
          className,
        )}
      >
        {props.status === "failed" ? failedLabel : notResearchedLabel}
      </span>
    )
  }

  const score = props.score
  return (
    <span
      role="img"
      aria-label={scoreLabel(score)}
      className={cn("inline-flex items-center gap-0.5", className)}
    >
      {[1, 2, 3].map((flame) => (
        <HugeiconsIcon
          key={flame}
          icon={Fire02Icon}
          strokeWidth={2}
          className={cn(
            "size-4",
            flame <= score ? "text-primary" : "text-muted-foreground/40",
          )}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}
