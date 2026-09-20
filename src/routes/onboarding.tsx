import { createFileRoute } from "@tanstack/react-router"
import { OnboardingPage } from "@/components/onboarding/OnboardingPage"

/**
 * Setup lives OUTSIDE `_dashboard` (PLAN §5): it is full-screen, with no
 * sidebar and no credits block, because none of them means anything until the
 * agent has been set up.
 *
 * No search parameters. Which screen the user is on is the agent row's
 * `onboardingStep`, so a reload, a Back press or a link shared between devices
 * all resume from the one place that knows — and a hand-edited URL can no
 * longer put someone on a step whose answers they never gave.
 *
 * The page itself holds the guards it needs: it redirects a signed-out visitor
 * to sign-in and a finished user to the dashboard.
 */
export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
})
