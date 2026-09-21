/** Save each selection immediately so leaving without Next still preserves it. */
import { useMutation, useQuery } from "convex/react"
import { useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
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
import { useMountedRef } from "@/hooks/use-mounted"
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
  const mounted = useMountedRef()
  const selected = useRef(0)

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
    // Ticks come faster than the writes answer, and the answer belongs to the
    // tick that asked for it: only the last one may put an error on the
    // screen, and only while the screen is still here.
    selected.current += 1
    const attempt = selected.current
    void (async () => {
      try {
        await setSelection({ orgId, strategyIds: next })
      } catch {
        if (mounted.current && selected.current === attempt) {
          setSaveError("We couldn't save that choice. Try it again.")
        }
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
      description="Pick the ones that sound like your best customers."
      error={saveError}
      moveError={moveError}
      nextDisabled={generating || moving || chosen.length === 0}
      nextHint={
        !generating && chosen.length === 0 ? "Pick at least one signal." : null
      }
      nextLoading={moving}
      onNext={goNext}
      progress={progress}
      title="Signals to track"
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
          description="Run it again to get suggestions."
          title="No signals yet"
        />
      ) : (
        <StrategyCardList
          disabled={moving}
          onToggle={toggle}
          strategies={strategies}
        />
      )}
    </SignalsStepShell>
  )
}
