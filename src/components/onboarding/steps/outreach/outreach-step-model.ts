/**
 * Dot 3's vocabulary: the props both sub-steps take, and the option tables
 * the goals screen draws (reference 05).
 *
 * The goal and tone unions come from the agent record the backend returns, so
 * adding a member there fails this build until the screen offers it.
 */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

/** The org's agent, as `api.agents.queries.get` returns it. */
type OnboardingAgent = NonNullable<
  FunctionReturnType<typeof api.agents.queries.get>
>

/**
 * What every onboarding sub-step is handed. It matches the shared
 * `OnboardingStepProps` the stepper defines; it is spelled out here so this
 * folder compiles on its own branch.
 */
export type OutreachStepProps = {
  orgId: Id<"orgs">
  agent: OnboardingAgent
  goNext: () => void
  goBack: () => void
}

export type AgentGoal = OnboardingAgent["goal"]
export type AgentTone = OnboardingAgent["tone"]

export type ChoiceOption<TValue extends string> = {
  value: TValue
  title: string
  description: string
}

/** Campaign goal (reference 05, top group). */
export const GOAL_OPTIONS: readonly ChoiceOption<AgentGoal>[] = [
  {
    value: "start_conversations",
    title: "Start conversations with warm prospects",
    description:
      "Open with something relevant and build the relationship before asking for time.",
  },
  {
    value: "book_calls",
    title: "Book qualified sales calls",
    description:
      "Go straight for a meeting, with your booking link in the first message.",
  },
]

/** Message tone (reference 05, bottom group). */
export const TONE_OPTIONS: readonly ChoiceOption<AgentTone>[] = [
  {
    value: "professional",
    title: "Professional",
    description: "Formal, polished",
  },
  {
    value: "conversational",
    title: "Conversational",
    description: "Friendly, casual",
  },
  { value: "direct", title: "Direct", description: "Bold, confident" },
]

/** Narrow a radio group's string back onto its union, or keep the current one. */
export function pickChoice<TValue extends string>(
  options: readonly ChoiceOption<TValue>[],
  value: string,
  fallback: TValue,
): TValue {
  return options.find((option) => option.value === value)?.value ?? fallback
}
