/**
 * The frame all three ICP screens share (references 06–08).
 *
 * Each screen renders its own `OnboardingShell`, as dot 1 does, and this sits
 * between them and it so the four things that are identical on all three are
 * written once: the AI-generated badge, the live state of the generation, the
 * Regenerate control with its real price, and the saving indicator.
 *
 * Leaving the screen — forwards or backwards — waits for the draft to be
 * written, so Previous and Next can never lose a chip that was clicked a
 * moment earlier.
 */
import { useState } from "react"
import type { ReactNode } from "react"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { icpFailureCopy } from "@/components/onboarding/steps/icp/icp-copy"
import { IcpFailurePanel } from "@/components/onboarding/steps/icp/IcpFailurePanel"
import { IcpRegenerateControl } from "@/components/onboarding/steps/icp/IcpRegenerateControl"
import { IcpSaveStatus } from "@/components/onboarding/steps/icp/IcpSaveStatus"
import type { IcpDraftHandle } from "@/components/onboarding/steps/icp/use-icp-draft"
import { useIcpGeneration } from "@/components/onboarding/steps/icp/use-icp-generation"
import type { IcpRunReason } from "@/components/onboarding/steps/icp/use-icp-generation"
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
  /** Blocks Next while this screen's own answer is missing. */
  nextDisabled?: boolean
  /** Says what is missing, when Next is blocked. */
  hint?: ReactNode
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
      description={description}
      dotCount={progress.dotCount}
      logo={<Logo markClassName="size-8" />}
      nextDisabled={nextDisabled || generating || moving || leaving}
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
      <div className="flex flex-col gap-6">
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

        {generating ? <GeneratingChips /> : children}

        <FormError message={draft.saveError ?? moveError} />
        {hint !== undefined && nextDisabled ? (
          <p className="text-sm text-muted-foreground">{hint}</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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

/** The shape of the chips, while they are being written. Never an empty row
 *  presented as a result (PLAN §2 "no placeholders"). */
function GeneratingChips() {
  return (
    <div aria-live="polite" className="flex flex-col gap-4" role="status">
      <span className="sr-only">Describing your ideal customer</span>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="h-9 w-40 rounded-full" />
        <Skeleton className="h-9 w-48 rounded-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-36 rounded-full" />
        <Skeleton className="h-9 w-52 rounded-full" />
      </div>
    </div>
  )
}
