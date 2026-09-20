import { createFileRoute } from "@tanstack/react-router"
import { OnboardingLayout } from "@/components/layout/OnboardingLayout"
import { STEP_IDS } from "@/components/onboarding/OnboardingWizard"
import type { StepId } from "@/components/onboarding/OnboardingWizard"
import { optionalOneOf } from "@/lib/search-params"

/**
 * Setup lives OUTSIDE `_dashboard` (PLAN §5): it is full-screen, with no
 * sidebar and no credits block, because none of them means anything until a
 * workspace and an agent exist. `OnboardingLayout` holds the guard.
 *
 * `?step=` so a reload, a Back press or a shared link lands on the step the
 * user was actually on. It stays OPTIONAL rather than defaulting to the first
 * step, because the wizard picks the right starting step from what is already
 * saved — a default here would override that on every fresh arrival.
 */
export const Route = createFileRoute("/onboarding")({
  validateSearch: (search): { step?: StepId } => ({
    step: optionalOneOf(STEP_IDS, search.step),
  }),
  component: OnboardingLayout,
})
