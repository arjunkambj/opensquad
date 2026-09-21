/** Onboarding progress comes from the agent row, never the URL or browser storage. */
import type { ComponentType } from "react"
import { ConvexError } from "convex/values"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { ONBOARDING_STEPS } from "../../../convex/lib/validators"
import type { OnboardingStep } from "../../../convex/lib/validators"
import { CompanyStep } from "@/components/onboarding/steps/company/CompanyStep"
import { CompanyFiltersStep } from "@/components/onboarding/steps/icp/CompanyFiltersStep"
import { ExclusionsStep } from "@/components/onboarding/steps/icp/ExclusionsStep"
import { JobTitlesStep } from "@/components/onboarding/steps/icp/JobTitlesStep"
import {
  OutreachGoalsStep,
  OutreachInboxStep,
} from "@/components/onboarding/steps/outreach/OutreachSteps"
import { KeywordsStep } from "@/components/onboarding/steps/signals/KeywordsStep"
import { ReviewStep } from "@/components/onboarding/steps/signals/ReviewStep"
import { StrategiesStep } from "@/components/onboarding/steps/signals/StrategiesStep"

export const ONBOARDING_DOT_COUNT = 4

type OnboardingProgress = {
  dot: number
  dotCount: number
  /** Sub-step inside this dot, 1-based. */
  step: number
  stepCount: number
}

export type OnboardingStepProps = {
  orgId: Id<"orgs">
  agent: Doc<"agents">
  progress: OnboardingProgress
  /** Save the move forward. The server refuses while this dot is unanswered. */
  goNext: () => void
  /** Absent on the very first screen, which has nothing behind it. */
  goBack?: () => void
  moving: boolean
  moveError: string | null
}

export type OnboardingStepEntry = {
  /** Which dot (1-based) this screen belongs to. */
  dot: number
  /** Its position inside that dot, 1-based. */
  stepInDot: number
  stepsInDot: number
  Component: ComponentType<OnboardingStepProps>
}

export const ONBOARDING_STEP_REGISTRY: Record<
  Exclude<OnboardingStep, "done">,
  OnboardingStepEntry
> = {
  company: { dot: 1, stepInDot: 1, stepsInDot: 1, Component: CompanyStep },
  icp_job_titles: {
    dot: 2,
    stepInDot: 1,
    stepsInDot: 3,
    Component: JobTitlesStep,
  },
  icp_company_filters: {
    dot: 2,
    stepInDot: 2,
    stepsInDot: 3,
    Component: CompanyFiltersStep,
  },
  icp_exclusions: {
    dot: 2,
    stepInDot: 3,
    stepsInDot: 3,
    Component: ExclusionsStep,
  },
  outreach_inbox: {
    dot: 3,
    stepInDot: 1,
    stepsInDot: 2,
    Component: OutreachInboxStep,
  },
  outreach_goals: {
    dot: 3,
    stepInDot: 2,
    stepsInDot: 2,
    Component: OutreachGoalsStep,
  },
  signals_strategies: {
    dot: 4,
    stepInDot: 1,
    stepsInDot: 3,
    Component: StrategiesStep,
  },
  signals_keywords: {
    dot: 4,
    stepInDot: 2,
    stepsInDot: 3,
    Component: KeywordsStep,
  },
  signals_review: {
    dot: 4,
    stepInDot: 3,
    stepsInDot: 3,
    Component: ReviewStep,
  },
}

/** Only Confirm may finish onboarding; ordinary step navigation must never return done. */
export function nextOnboardingStep(
  step: OnboardingStep,
): OnboardingStep | null {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1]
  return next === undefined || next === "done" ? null : next
}

export function previousOnboardingStep(
  step: OnboardingStep,
): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step)
  return index <= 0 ? null : (ONBOARDING_STEPS[index - 1] ?? null)
}

/** Map ensureOrg refusals to entry states; unexpected errors remain retryable. */
export type OnboardingEntryRefusal =
  | "ACCOUNT_RESTRICTED"
  | "TRIAL_CAPACITY_REACHED"
  | "unknown"

const ENTRY_REFUSALS = [
  "ACCOUNT_RESTRICTED",
  "TRIAL_CAPACITY_REACHED",
] as const

export function entryRefusalOf(error: unknown): OnboardingEntryRefusal {
  if (error instanceof ConvexError) {
    const data: unknown = error.data
    if (typeof data === "object" && data !== null) {
      const code = (data as { code?: unknown }).code
      const match = ENTRY_REFUSALS.find((refusal) => refusal === code)
      if (match !== undefined) {
        return match
      }
    }
  }
  return "unknown"
}
