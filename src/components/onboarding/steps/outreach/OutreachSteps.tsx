import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { ConnectInboxStep } from "@/components/onboarding/steps/outreach/ConnectInboxStep"
import { GoalsStep } from "@/components/onboarding/steps/outreach/GoalsStep"

/**
 * Dot 3 as the onboarding page mounts it. The page's shared step props make
 * `goBack` optional because the very first screen has nothing behind it; dot 3
 * always does, so the fallback below is never reached — it only keeps the two
 * prop shapes honest instead of asserting one into the other.
 */
function stayHere(): void {}

export function OutreachInboxStep(props: OnboardingStepProps) {
  return (
    <ConnectInboxStep
      workspaceId={props.workspaceId}
      agent={props.agent}
      goNext={props.goNext}
      goBack={props.goBack ?? stayHere}
    />
  )
}

export function OutreachGoalsStep(props: OnboardingStepProps) {
  return (
    <GoalsStep
      workspaceId={props.workspaceId}
      agent={props.agent}
      goNext={props.goNext}
      goBack={props.goBack ?? stayHere}
    />
  )
}
