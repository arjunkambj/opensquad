import { createFileRoute } from "@tanstack/react-router"
import { OnboardingPage } from "@/components/onboarding/OnboardingPage"

/** Onboarding progress comes from the agent row, so reloads and other devices resume the saved step. */
export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
})
