/**
 * Onboarding dot 4, screen 1 — the signals to track (reference 09).
 *
 * A signal is the user's ideal customer AND one reason to contact them now,
 * and every card carries the real number of people that combination matches.
 * That number is the whole point of the screen: it is what turns "recently
 * funded companies" from a nice idea into a decision the user can make, and
 * it is why a card with none is switched off and stays off.
 *
 * The selection is written straight through. Each tick is one small mutation
 * rather than a draft flushed on Next, so leaving by Previous, by Next or by
 * closing the tab all leave the same thing behind.
 */
import { InformationCircleIcon } from "@hugeicons/core-free-icons"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
import { InfoBanner } from "@/components/kit/InfoBanner"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { signalsFailureCopy } from "@/components/onboarding/steps/signals/signals-copy"
import { strategyIsSelectable } from "@/components/onboarding/steps/signals/signals-model"
import { SignalsFailurePanel } from "@/components/onboarding/steps/signals/SignalsFailurePanel"
import { SignalsRegenerateControl } from "@/components/onboarding/steps/signals/SignalsRegenerateControl"
import { SignalsStepShell } from "@/components/onboarding/steps/signals/SignalsStepShell"
import {
  StrategyCardList,
  StrategyCardSkeletons,
} from "@/components/onboarding/steps/signals/StrategyCardList"
import { useStrategyRecommendation } from "@/components/onboarding/steps/signals/use-strategy-recommendation"
import type { SignalsRunReason } from "@/components/onboarding/steps/signals/use-strategy-recommendation"
import { EmptyState } from "@/components/states/states"

export function StrategiesStep(props: OnboardingStepProps) {
  const { orgId, progress, goNext, goBack, moving, moveError } = props
  const overview = useQuery(api.agents.strategies.overview, { orgId })
  const setSelection = useMutation(api.agents.strategies.setSelection)
  const generation = useStrategyRecommendation(
    orgId,
    overview === undefined ? undefined : overview.generation,
  )
  const [saveError, setSaveError] = useState<string | null>(null)

  const view = generation.view
  const generating = view.state === "generating"
  const strategies = overview?.strategies ?? []
  const chosen = strategies.filter(
    (strategy) => strategy.enabled && strategyIsSelectable(strategy.matchCount),
  )

  // A lost run reads to the user exactly like one that came back broken, and
  // gets the same way out. The server only accepts `retry` on a run it
  // recorded as failed, so a stalled one asks for a fresh recommendation.
  const retryReason: SignalsRunReason =
    view.state === "failed" ? "retry" : "regenerate"
  const wentWrong = view.state === "failed" || view.state === "stalled"
  const showRegenerate = !generating && view.state !== "never"

  const toggle = (strategyId: Id<"strategies">, enabled: boolean) => {
    const next = enabled
      ? [...chosen.map((strategy) => strategy._id), strategyId]
      : chosen
          .map((strategy) => strategy._id)
          .filter((id) => id !== strategyId)
    setSaveError(null)
    void (async () => {
      try {
        await setSelection({ orgId, strategyIds: next })
      } catch {
        setSaveError("We couldn't save that choice. Try it again.")
      }
    })()
  }

  return (
    <SignalsStepShell
      aside={
        showRegenerate ? (
          <SignalsRegenerateControl
            blockedReason={generation.blockedReason}
            disabled={generation.starting}
            label={wentWrong ? "Try again" : "Regenerate"}
            onRun={() => {
              generation.run(retryReason)
            }}
            price={generation.price}
          />
        ) : undefined
      }
      badge={
        view.state === "ready" ? <AiGeneratedBadge label="AI-generated" /> : null
      }
      description="These are the strongest reasons to reach the people you just described. Pick the ones that sound like your best customers."
      error={saveError}
      moveError={moveError}
      nextDisabled={generating || moving || chosen.length === 0}
      nextLoading={moving}
      onNext={goNext}
      progress={progress}
      title="Here are the first signals we think you should track"
      {...(goBack === undefined
        ? {}
        : { onPrevious: goBack, previousDisabled: moving })}
    >
      {generation.refusal !== null ? (
        <SignalsFailurePanel
          message={generation.refusal.message}
          onRetry={() => {
            generation.clearRefusal()
            generation.run(generation.refusal?.reason ?? retryReason)
          }}
          retryDisabled={generation.starting}
        />
      ) : null}

      {wentWrong ? (
        <SignalsFailurePanel
          message={
            view.state === "failed"
              ? signalsFailureCopy(view.code)
              : signalsFailureCopy("provider_unavailable")
          }
          onRetry={() => {
            generation.run(retryReason)
          }}
          retryBlockedReason={generation.blockedReason}
          retryDisabled={generation.starting}
        />
      ) : null}

      {generating || overview === undefined ? (
        <StrategyCardSkeletons />
      ) : strategies.length === 0 ? (
        <EmptyState
          description="Nothing has been worked out for this agent yet. Run it again and we'll look at your profile and your ideal customer."
          title="No signals yet"
        />
      ) : (
        <StrategyCardList
          disabled={moving}
          onToggle={toggle}
          strategies={strategies}
        />
      )}

      <InfoBanner icon={InformationCircleIcon} tone="plain">
        Don&rsquo;t overthink it — you can change which signals your agent
        tracks at any time.
      </InfoBanner>
    </SignalsStepShell>
  )
}
