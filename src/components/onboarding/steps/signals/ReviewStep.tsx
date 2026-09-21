/** Confirm counts keywords and activates the agent; the run loop starts work when nextRunAt is due. */
import { Target01Icon } from "@hugeicons/core-free-icons"
import { useAction, useMutation, useQuery } from "convex/react"
import { useRef, useState } from "react"
import { api } from "../../../../../convex/_generated/api"
import type { OnboardingStep } from "../../../../../convex/lib/validators"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { ReviewAccordion } from "@/components/kit/ReviewAccordion"
import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { buildReviewRows } from "@/components/onboarding/steps/signals/review-rows"
import { ReviewRowEditor } from "@/components/onboarding/steps/signals/ReviewRowEditor"
import {
  CONFIRM_FALLBACK,
  confirmBlockCopy,
} from "@/components/onboarding/steps/signals/signals-copy"
import type { SignalsMessage } from "@/components/onboarding/steps/signals/signals-copy"
import { SignalsFailurePanel } from "@/components/onboarding/steps/signals/SignalsFailurePanel"
import { SignalsStepShell } from "@/components/onboarding/steps/signals/SignalsStepShell"
import { useMountedRef } from "@/hooks/use-mounted"
import { EmptyState } from "@/components/states/states"
import { Skeleton } from "@/components/ui/skeleton"

type StepFailure = { message: SignalsMessage; from: "confirm" | "step" }

export function ReviewStep(props: OnboardingStepProps) {
  const { orgId, agent, progress, goBack, moving, moveError } = props
  const profile = useQuery(api.company.queries.get, { orgId })
  const overview = useQuery(api.agents.strategies.overview, { orgId })
  const setStep = useMutation(api.agents.onboarding.setStep)
  const confirm = useAction(api.agents.strategies.confirm)

  const [confirming, setConfirming] = useState(false)
  const mounted = useMountedRef()
  // The panel's "Try again" has to do the thing that failed, so a failure
  // carries which one it was — re-running a confirm to reopen a step would be
  // a button that lies about what it does.
  const [failure, setFailure] = useState<StepFailure | null>(null)

  const loading = profile === undefined || overview === undefined
  const signals = (overview?.strategies ?? [])
    .filter((strategy) => strategy.enabled)
    .map((strategy) => strategy.title)

  const [lastStep, setLastStep] = useState<OnboardingStep | null>(null)

  // Confirm can be pressed again while its last press is still in flight —
  // the failure panel offers exactly that. The answer belongs to the press
  // that asked for it, so only the latest one may put anything on the
  // screen, and only while the screen is still here.
  const attempts = useRef(0)

  // Only the latest jump may report failure, and only while this screen is mounted.
  const jumps = useRef(0)

  const jumpTo = (step: OnboardingStep) => {
    setFailure(null)
    setLastStep(step)
    jumps.current += 1
    const attempt = jumps.current
    void (async () => {
      try {
        await setStep({ orgId, step })
      } catch {
        if (!mounted.current || jumps.current !== attempt) {
          return
        }
        setFailure({
          from: "step",
          message: {
            title: "We couldn't open that step",
            description: "Try again in a moment.",
          },
        })
      }
    })()
  }

  const finish = () => {
    setConfirming(true)
    setFailure(null)
    attempts.current += 1
    const attempt = attempts.current
    void (async () => {
      try {
        const result = await confirm({ orgId })
        if (!mounted.current || attempts.current !== attempt) {
          return
        }
        if (result.status === "blocked") {
          setFailure({
            from: "confirm",
            message: confirmBlockCopy(result.reason),
          })
          setConfirming(false)
        }
        // Keep Confirm disabled until the parent sees done on the subscribed row and navigates away.
      } catch {
        if (mounted.current && attempts.current === attempt) {
          setFailure({ from: "confirm", message: CONFIRM_FALLBACK })
          setConfirming(false)
        }
      }
    })()
  }

  return (
    <SignalsStepShell
      description="Your agent starts from this. Everything here can be changed later."
      icon={Target01Icon}
      moveError={moveError}
      nextDisabled={loading || confirming || moving || signals.length === 0}
      nextLabel="Confirm & find leads"
      nextLoading={confirming}
      onNext={finish}
      progress={progress}
      title="Check your setup before we find your leads"
      {...(goBack === undefined
        ? {}
        : {
            onPrevious: goBack,
            previousDisabled: moving || confirming,
          })}
    >
      {failure === null ? null : (
        <SignalsFailurePanel
          message={failure.message}
          onRetry={() => {
            if (failure.from === "confirm") {
              finish()
              return
            }
            if (lastStep !== null) {
              jumpTo(lastStep)
            }
          }}
          retryDisabled={confirming}
        />
      )}

      <InfoBanner title="Your agent will use this to find and surface the people most likely to reply.">
        Fine-tune anything below to change who it looks for.
      </InfoBanner>

      {loading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : profile === null ? (
        <EmptyState
          description="Go back to the first step and save your company profile — your agent writes from it."
          title="Your company profile is missing"
        />
      ) : (
        <ReviewAccordion
          className="overflow-hidden rounded-2xl border"
          rows={buildReviewRows({
            companyName: profile.companyName,
            industry: profile.industry,
            icp: agent.icp,
            goal: agent.goal,
            tone: agent.tone,
            signals,
            keywords: overview.keywords,
          }).map(({ step, hint, ...row }) => ({
            ...row,
            content: (
              <ReviewRowEditor
                disabled={moving || confirming}
                hint={hint}
                onEdit={() => jumpTo(step)}
              />
            ),
          }))}
        />
      )}

      {signals.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">
          Go back to the signals step and switch on at least one, so your agent
          has somewhere to start looking.
        </p>
      ) : null}
    </SignalsStepShell>
  )
}
