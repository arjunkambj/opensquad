/** Navigate to Overview only when the subscribed agent reads done.
 * Navigating on the action result can race the route guard and bounce back to setup. */
import { Navigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useRef, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { OnboardingStep } from "../../../convex/lib/validators"
import {
  nextOnboardingStep,
  ONBOARDING_DOT_COUNT,
  ONBOARDING_STEP_REGISTRY,
  previousOnboardingStep,
} from "@/components/onboarding/onboarding-model"
import { OnboardingSkeleton } from "@/components/onboarding/OnboardingSkeleton"
import { SetupFrame } from "@/components/onboarding/SetupFrame"
import { useMountedRef } from "@/hooks/use-mounted"
import { ErrorState } from "@/components/states/states"
import { domainErrorCode } from "@/lib/convex-error"

export function AgentSetupFlow({ orgId }: { orgId: Id<"orgs"> }) {
  const agent = useQuery(api.agents.queries.get, { orgId })
  const setStep = useMutation(api.agents.onboarding.setStep)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  const mounted = useMountedRef()
  // A step change can be asked for again before the last one answered — two
  // presses of Next, or Next and then Previous. The answer belongs to the
  // move that asked for it, so only the latest may report a failure.
  const moves = useRef(0)

  if (agent === undefined) {
    return (
      <OnboardingSkeleton label="Picking up where you left off" />
    )
  }

  if (agent === null) {
    return (
      <SetupFrame>
        <ErrorState
          description="This organization has no agent to set up, which shouldn't happen. Reload the page and we'll try again."
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
          title="Your agent is missing"
        />
      </SetupFrame>
    )
  }

  if (agent.onboardingStep === "done") {
    return <Navigate replace to="/overview" />
  }

  // Every step but `done` has a screen, and the registry's type says so — a
  // step added without one fails the build rather than reaching a user.
  const entry = ONBOARDING_STEP_REGISTRY[agent.onboardingStep]

  const move = async (step: OnboardingStep) => {
    moves.current += 1
    const attempt = moves.current
    setMoving(true)
    setMoveError(null)
    try {
      await setStep({ orgId, step })
    } catch (cause) {
      if (mounted.current && moves.current === attempt) {
        setMoveError(
          domainErrorCode(cause) === "INVALID"
            ? "Finish this step before moving on."
            : "We couldn't save your progress. Try that again.",
        )
      }
    } finally {
      if (mounted.current && moves.current === attempt) {
        setMoving(false)
      }
    }
  }

  const forward = nextOnboardingStep(agent.onboardingStep)
  const backward = previousOnboardingStep(agent.onboardingStep)
  const StepScreen = entry.Component

  return (
    <StepScreen
      agent={agent}
      goNext={() => {
        if (forward !== null) {
          void move(forward)
        }
      }}
      moveError={moveError}
      moving={moving}
      progress={{
        dot: entry.dot,
        dotCount: ONBOARDING_DOT_COUNT,
        step: entry.stepInDot,
        stepCount: entry.stepsInDot,
      }}
      orgId={orgId}
      {...(backward === null
        ? {}
        : { goBack: () => void move(backward) })}
    />
  )
}
