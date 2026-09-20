/**
 * The frame all three ICP screens share (references 06–08).
 *
 * Each screen renders its own `OnboardingShell`, as dot 1 does, and this sits
 * between them and it so the four things that are identical on all three are
 * written once: the AI-generated badge, the live state of the generation, the
 * Regenerate control with its real price, and the saving indicator.
 *
 * It also owns the automatic first run. Entering dot 2 asks for one, and the
 * mutation is a no-op unless the agent has never had a generation — so this
 * effect is safe on every mount, on every device, forever, and the run it
 * starts is the free one (PLAN §6).
 */
import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../../../convex/_generated/api"
import { AiGeneratedBadge } from "@/components/kit/AiGeneratedBadge"
import { OnboardingShell } from "@/components/kit/OnboardingShell"
import Logo from "@/components/layout/Logo"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { IcpFailurePanel } from "@/components/onboarding/steps/icp/IcpFailurePanel"
import {
  icpFailureCopy,
  icpGenerationPrice,
  icpGenerationView,
  startGenerationCopy,
} from "@/components/onboarding/steps/icp/icp-model"
import type { IcpMessage } from "@/components/onboarding/steps/icp/icp-model"
import { IcpRegenerateControl } from "@/components/onboarding/steps/icp/IcpRegenerateControl"
import { IcpSaveStatus } from "@/components/onboarding/steps/icp/IcpSaveStatus"
import type { IcpDraftHandle } from "@/components/onboarding/steps/icp/use-icp-draft"
import { FormError } from "@/components/states/states"
import { Skeleton } from "@/components/ui/skeleton"

/** Why a run was asked for. `initial` is the automatic free one. */
type RunReason = "initial" | "retry" | "regenerate"

/** A refused request, with the run it was refusing — so Try again asks for
 *  the same thing and a refused FREE run is never retried as a paid one. */
type StartRefusal = { message: IcpMessage; reason: RunReason }

export type IcpStepShellProps = Pick<
  OnboardingStepProps,
  | "workspaceId"
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
  workspaceId,
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
  const startGeneration = useMutation(api.agents.icp.startGeneration)
  const balance = useQuery(api.billing.credits.balance, { workspaceId })

  const [refusal, setRefusal] = useState<StartRefusal | null>(null)
  const [failureDismissed, setFailureDismissed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const view = icpGenerationView(agent)
  const generating = view.state === "generating"
  const price = icpGenerationPrice(view)

  const run = useCallback(
    async (reason: RunReason) => {
      setStarting(true)
      setRefusal(null)
      try {
        await startGeneration({ workspaceId, reason })
        setFailureDismissed(false)
      } catch (cause) {
        setRefusal({ message: startGenerationCopy(cause), reason })
      } finally {
        setStarting(false)
      }
    },
    [startGeneration, workspaceId],
  )

  // One automatic request per mount. The server decides whether it runs.
  const requested = useRef(false)
  useEffect(() => {
    if (view.state !== "never" || requested.current) {
      return
    }
    requested.current = true
    void run("initial")
  }, [run, view.state])

  const blockedReason =
    balance === undefined || price === 0
      ? null
      : balance === null
        ? "This workspace has no credit allowance, so another run can't happen. You can still edit everything here yourself."
        : balance.remaining < price
          ? `Another run costs ${price} credits and you have ${balance.remaining} left. Edit the chips yourself to carry on.`
          : null

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

  // A lost run reads to the user exactly like one that came back broken, and
  // gets the same two ways out. The server only accepts `retry` on a run it
  // recorded as failed, so a stalled one asks for a fresh generation.
  const retryReason: RunReason = view.state === "failed" ? "retry" : "regenerate"
  const wentWrong = view.state === "failed" || view.state === "stalled"
  const failureMessage =
    view.state === "failed"
      ? icpFailureCopy(view.code)
      : icpFailureCopy("provider_unavailable")
  const showFailure = wentWrong && !failureDismissed
  // Nothing to regenerate before the first run, and nothing to press while
  // one is going — unless it has been going far longer than a run can take,
  // in which case pressing it is the only way out.
  const showRegenerate = !generating && view.state !== "never"

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
        {refusal !== null ? (
          <IcpFailurePanel
            message={refusal.message}
            onFillManually={() => {
              setRefusal(null)
            }}
            onRetry={() => void run(refusal.reason)}
            retryDisabled={starting}
          />
        ) : null}

        {showFailure ? (
          <IcpFailurePanel
            message={failureMessage}
            onFillManually={() => {
              setFailureDismissed(true)
            }}
            onRetry={() => void run(retryReason)}
            retryBlockedReason={blockedReason}
            retryDisabled={starting || blockedReason !== null}
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
              blockedReason={blockedReason}
              disabled={starting}
              label={wentWrong ? "Try again" : "Regenerate"}
              onRun={() => void run(retryReason)}
              price={price}
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
