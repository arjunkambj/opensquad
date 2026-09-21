import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"

type OnboardingAgent = NonNullable<
  FunctionReturnType<typeof api.agents.queries.get>
>

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

export function pickChoice<TValue extends string>(
  options: readonly ChoiceOption<TValue>[],
  value: string,
  fallback: TValue,
): TValue {
  return options.find((option) => option.value === value)?.value ?? fallback
}
