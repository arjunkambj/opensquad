/** Wait for the draft to flush before either Previous or Next leaves the screen. */
import { useState } from "react"
import type { ReactNode } from "react"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import { onboardingStageLabel } from "@/components/onboarding/onboarding-stages"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { icpFailureCopy } from "@/components/onboarding/steps/icp/icp-copy"
import { IcpFailurePanel } from "@/components/onboarding/steps/icp/IcpFailurePanel"
import { IcpRegenerateControl } from "@/components/onboarding/steps/icp/IcpRegenerateControl"
import { IcpSaveStatus } from "@/components/onboarding/steps/icp/IcpSaveStatus"
import type { IcpDraftHandle } from "@/components/onboarding/steps/icp/use-icp-draft"
import { useIcpGeneration } from "@/components/onboarding/steps/icp/use-icp-generation"
import type { IcpRunReason } from "@/components/onboarding/steps/icp/use-icp-generation"
import { SkeletonRegion } from "@/components/states/skeletons"
import { FormError } from "@/components/states/states"
import { Skeleton } from "@/components/ui/skeleton"

export type IcpStepShellProps = Pick<
  OnboardingStepProps,
  | "orgId"
  | "agent"
  | "progress"
  | "goNext"
  | "goBack"
  | "moving"
  | "moveError"
> & {
  draft: IcpDraftHandle
  title: string
  description: ReactNode
  nextDisabled?: boolean
  hint?: ReactNode
  /** Stands in for `children` while a run is drafting them. Defaults to a chip row. */
  skeleton?: ReactNode
  children: ReactNode
}

export function IcpStepShell({
  orgId,
  agent,
  progress,
  goNext,
  goBack,
  moving,
  moveError,
  draft,
  title,
  description,
  nextDisabled = false,
  hint,
  skeleton,
  children,
}: IcpStepShellProps) {
  const generation = useIcpGeneration(orgId, agent)
  const [failureDismissed, setFailureDismissed] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const view = generation.view
  const generating = view.state === "generating"

  // A lost run reads to the user exactly like one that came back broken, and
  // gets the same two ways out. The server only accepts `retry` on a run it
  // recorded as failed, so a stalled one asks for a fresh generation.
  const retryReason: IcpRunReason =
    view.state === "failed" ? "retry" : "regenerate"
  const wentWrong = view.state === "failed" || view.state === "stalled"
  const showFailure = wentWrong && !failureDismissed
  // Nothing to regenerate before the first run, and nothing to press while
  // one is going — unless it has been going far longer than a run can take,
  // in which case pressing it is the only way out.
  const showRegenerate = !generating && view.state !== "never"

  const move = (go: () => void) => {
    setLeaving(true)
    void (async () => {
      try {
        if (await draft.flush()) {
          go()
        }
      } finally {
        setLeaving(false)
      }
    })()
  }

  const retry = (reason: IcpRunReason) => {
    setFailureDismissed(false)
    generation.run(reason)
  }

  return (
    <OnboardingShell
      badge={
        view.state === "ready" ? <AiGeneratedBadge label="AI-generated" /> : null
      }
      currentDot={progress.dot}
      stageLabel={onboardingStageLabel(progress.dot)}
      description={description}
      dotCount={progress.dotCount}
      logo={<Logo markClassName="size-8" />}
      nextDisabled={nextDisabled || generating || moving || leaving}
      nextHint={nextDisabled && !generating ? hint : null}
      nextLoading={leaving || moving}
      onNext={() => {
        move(goNext)
      }}
      step={progress.step}
      stepCount={progress.stepCount}
      stepperLabel="Setup progress"
      title={title}
      {...(goBack === undefined
        ? {}
        : {
            onPrevious: () => {
              move(goBack)
            },
            previousDisabled: moving || leaving,
          })}
    >
      <div className="flex flex-col gap-8">
        {generation.refusal !== null ? (
          <IcpFailurePanel
            message={generation.refusal.message}
            onFillManually={generation.clearRefusal}
            onRetry={() => {
              retry(generation.refusal?.reason ?? retryReason)
            }}
            retryDisabled={generation.starting}
          />
        ) : null}

        {showFailure ? (
          <IcpFailurePanel
            message={
              view.state === "failed"
                ? icpFailureCopy(view.code)
                : icpFailureCopy("provider_unavailable")
            }
            onFillManually={() => {
              setFailureDismissed(true)
            }}
            onRetry={() => {
              retry(retryReason)
            }}
            retryBlockedReason={generation.blockedReason}
            retryDisabled={
              generation.starting || generation.blockedReason !== null
            }
          />
        ) : null}

        {generating ? (skeleton ?? <GeneratingChips />) : children}

        <FormError message={draft.saveError ?? moveError} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <IcpSaveStatus state={draft.saveState} />
          {showRegenerate ? (
            <IcpRegenerateControl
              blockedReason={generation.blockedReason}
              disabled={generation.starting}
              label={wentWrong ? "Try again" : "Regenerate"}
              onRun={() => {
                retry(retryReason)
              }}
              price={generation.price}
            />
          ) : null}
        </div>
      </div>
    </OnboardingShell>
  )
}

function GeneratingChips() {
  return (
    <SkeletonRegion
      label="Suggesting who to target"
      className="flex-row flex-wrap gap-2"
    >
      <Skeleton shape="lg" className="h-8 w-40" />
      <Skeleton shape="lg" className="h-8 w-28" />
      <Skeleton shape="lg" className="h-8 w-36" />
      <Skeleton shape="lg" className="h-8 w-24" />
      <Skeleton shape="lg" className="h-8 w-32" />
    </SkeletonRegion>
  )
}
