import type { OnboardingStepProps } from "@/components/onboarding/onboarding-model"
import { ConnectInboxStep } from "@/components/onboarding/steps/outreach/ConnectInboxStep"
import { GoalsStep } from "@/components/onboarding/steps/outreach/GoalsStep"

function stayHere(): void {}

export function OutreachInboxStep(props: OnboardingStepProps) {
  return (
    <ConnectInboxStep
      orgId={props.orgId}
      agent={props.agent}
      goNext={props.goNext}
      goBack={props.goBack ?? stayHere}
      moving={props.moving}
      moveError={props.moveError}
    />
  )
}

export function OutreachGoalsStep(props: OnboardingStepProps) {
  return (
    <GoalsStep
      orgId={props.orgId}
      agent={props.agent}
      goNext={props.goNext}
      goBack={props.goBack ?? stayHere}
      moving={props.moving}
      moveError={props.moveError}
    />
  )
}
