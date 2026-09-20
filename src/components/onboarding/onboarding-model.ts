/**
 * The shape of onboarding: which screen belongs to which dot, how a step moves
 * to the next one, and our own words for the refusals the entry to setup can
 * return.
 *
 * Progress is the agent row's `onboardingStep` (PLAN §5). Nothing here reads a
 * URL or browser storage, so a refresh, another device or a sign-out and back
 * all resume on the same screen.
 */
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

/* ------------------------------------------------------------------ */
/* Where a step sits in the four dots                                   */
/* ------------------------------------------------------------------ */

/** The four macro stages of PLAN §11 M1: company, ICP, outreach, signals. */
export const ONBOARDING_DOT_COUNT = 4

/** What a step tells `OnboardingShell` about its own position. */
export type OnboardingProgress = {
  dot: number
  dotCount: number
  /** Sub-step inside this dot, 1-based. */
  step: number
  stepCount: number
}

/** Everything a step screen is given. One shape for all four dots. */
export type OnboardingStepProps = {
  workspaceId: Id<"workspaces">
  agent: Doc<"agents">
  progress: OnboardingProgress
  /** Save the move forward. The server refuses while this dot is unanswered. */
  goNext: () => void
  /** Absent on the very first screen, which has nothing behind it. */
  goBack?: () => void
  /** A step change is being saved. */
  moving: boolean
  /** Our copy for a refused step change, or `null`. */
  moveError: string | null
}

export type OnboardingStepEntry = {
  /** Which dot (1-based) this screen belongs to. */
  dot: number
  /** Its position inside that dot, 1-based. */
  stepInDot: number
  /** How many screens that dot has in total. */
  stepsInDot: number
  Component: ComponentType<OnboardingStepProps>
}

/**
 * Every screen in setup.
 *
 * TOTAL on purpose, now that the last dot has landed: the type is every
 * `OnboardingStep` except `done`, which is not a screen but the state the
 * `/onboarding` guard redirects away from. Adding a step to
 * `ONBOARDING_STEPS` without a screen for it now fails the build, which is
 * the only moment anyone would notice.
 */
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

/* ------------------------------------------------------------------ */
/* Moving between steps                                                 */
/* ------------------------------------------------------------------ */

/**
 * The step after this one, or `null` when there is none to move to.
 *
 * `done` is never returned: finishing onboarding is the last dot's Confirm,
 * which does more than change a step, and the server refuses it here too.
 */
export function nextOnboardingStep(
  step: OnboardingStep,
): OnboardingStep | null {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1]
  return next === undefined || next === "done" ? null : next
}

/** The step before this one, or `null` on the first screen. */
export function previousOnboardingStep(
  step: OnboardingStep,
): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step)
  return index <= 0 ? null : (ONBOARDING_STEPS[index - 1] ?? null)
}

/* ------------------------------------------------------------------ */
/* Getting into setup at all                                            */
/* ------------------------------------------------------------------ */

/**
 * Why the workspace could not be prepared. These are the typed refusals
 * `workspaces.ensureWorkspace` returns (PLAN §6 "Closing the ways in"); every
 * other failure is `unknown` and gets the retryable error state.
 */
export type OnboardingEntryRefusal =
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_RESTRICTED"
  | "TRIAL_CAPACITY_REACHED"
  | "unknown"

const ENTRY_REFUSALS = [
  "EMAIL_NOT_VERIFIED",
  "ACCOUNT_RESTRICTED",
  "TRIAL_CAPACITY_REACHED",
] as const

/** Read the backend's code off a failed `ensureWorkspace` call. */
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
