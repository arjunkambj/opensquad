/** Names for the stepper's dots, in order; shown above each step's title. */
export const ONBOARDING_STAGE_LABELS = [
  "Company",
  "Ideal customer",
  "Outreach",
  "Signals",
] as const

export function onboardingStageLabel(dot: number): string | undefined {
  return ONBOARDING_STAGE_LABELS[dot - 1]
}
