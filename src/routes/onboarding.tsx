import { createFileRoute } from "@tanstack/react-router"
import { OnboardingPage } from "@/components/onboarding/OnboardingPage"
import { STEP_IDS } from "@/components/onboarding/OnboardingWizard"
import type { StepId } from "@/components/onboarding/OnboardingWizard"
import { optionalOneOf } from "@/lib/search-params"

/**
 * `?step=` so a reload, a Back press or a shared link lands on the step the
 * user was actually on. It stays OPTIONAL rather than defaulting to the first
 * step, because the wizard picks the right starting step from what is already
 * saved — a default here would override that on every fresh arrival.
 */
export const Route = createFileRoute("/_dashboard/onboarding")({
  validateSearch: (search): { step?: StepId } => ({
    step: optionalOneOf(STEP_IDS, search.step),
  }),
  component: OnboardingPage,
})
