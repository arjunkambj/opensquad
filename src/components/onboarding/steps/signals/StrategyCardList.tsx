import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { CheckCard } from "@/components/kit/CheckCard"
import {
  matchCountLabel,
  strategyIsSelectable,
} from "@/components/onboarding/steps/signals/signals-model"
import { TextLine } from "@/components/onboarding/OnboardingSkeleton"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

type StrategyCard = FunctionReturnType<
  typeof api.agents.strategies.overview
>["strategies"][number]

export type StrategyCardListProps = {
  strategies: StrategyCard[]
  onToggle: (strategyId: Id<"strategies">, enabled: boolean) => void
  disabled?: boolean
}

export function StrategyCardList({
  strategies,
  onToggle,
  disabled = false,
}: StrategyCardListProps) {
  return (
    <div className="flex flex-col gap-3">
      {strategies.map((strategy) => {
        const selectable = strategyIsSelectable(strategy.matchCount)
        return (
          <CheckCard
            checked={strategy.enabled}
            count={strategy.matchCount}
            countLabel={matchCountLabel(strategy.matchCount)}
            // "About 12,000 matches" when the provider estimated the number
            // rather than counted it — the screen never reads an estimate out
            // as an exact figure.
            countPrefix={strategy.matchCountIsApproximate ? "About" : undefined}
            disabled={disabled || !selectable}
            info={strategy.rationale}
            infoLabel={`Why we suggest ${strategy.title}`}
            key={strategy._id}
            onCheckedChange={(checked) => {
              onToggle(strategy._id, checked)
            }}
            title={strategy.title}
            {...(selectable
              ? {}
              : {
                  description:
                    "No matches right now.",
                })}
          />
        )
      })}
    </div>
  )
}

/** Each row is `CheckCard`'s own box — checkbox, title, count, info button — so the cards land in place. */
export function StrategyCardSkeletons({ rows = 4 }: { rows?: number }) {
  const widths = ["w-48", "w-40", "w-56", "w-36"]
  return (
    <SkeletonRegion label="Finding signals" className="gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="flex items-center gap-3 rounded-lg bg-muted/50 px-4 py-3"
          key={index}
        >
          <Skeleton shape="lg" className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <TextLine className={widths[index % widths.length]} />
          </div>
          <Skeleton shape="lg" className="h-5 w-24 shrink-0" />
          <Skeleton shape="full" className="size-6 shrink-0" />
        </div>
      ))}
    </SkeletonRegion>
  )
}
