/**
 * The signal cards of reference 09 — one `CheckCard` per search strategy.
 *
 * Every number on this screen is a real count from a free count call made
 * when the strategies were recommended (PLAN §3 step 4), which is why a card
 * that matches nobody says so and cannot be ticked: switching it on would
 * spend one of the agent's searches on an empty page.
 *
 * Data-free: the rows, the selection and the handler are all the caller's.
 */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { CheckCard } from "@/components/kit/CheckCard"
import {
  matchCountLabel,
  strategyIsSelectable,
} from "@/components/onboarding/steps/signals/signals-model"
import { Skeleton } from "@/components/ui/skeleton"

export type StrategyCard = FunctionReturnType<
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
                    "Nobody matches this right now, so we've left it switched off.",
                })}
          />
        )
      })}
    </div>
  )
}

/** The shape of the cards while they are being worked out. Never an empty row
 *  presented as a result (PLAN §2 "no placeholders"). */
export function StrategyCardSkeletons({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-live="polite" className="flex flex-col gap-3" role="status">
      <span className="sr-only">
        Working out which signals are worth tracking
      </span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton className="h-[58px] w-full rounded-2xl" key={index} />
      ))}
    </div>
  )
}
