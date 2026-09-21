import { domainErrorCode } from "@/lib/convex-error"
import type { OperationErrorCode } from "../../../../../convex/lib/validators"

export type SignalsMessage = {
  title: string
  description: string
}

export function signalsFailureCopy(code: OperationErrorCode): SignalsMessage {
  switch (code) {
    case "invalid_response":
      return {
        title: "We couldn't turn your profile into signals",
        description:
          "The answer didn't come back in a shape we could use. Try again — it usually works the second time.",
      }
    case "not_found":
      return {
        title: "Your company profile has gone",
        description:
          "There was nothing to read your signals from. Go back to the first step, check the profile, then try again.",
      }
    case "rate_limited":
      return {
        title: "That's a lot of runs in a row",
        description: "Give it a minute and try again.",
      }
    case "insufficient_credits":
      return {
        title: "No credits left for another run",
        description:
          "Your trial allowance for this step is used up. The signals already on this screen still work — pick the ones you want and carry on.",
      }
    case "platform_paused":
      return {
        title: "This step is paused right now",
        description:
          "We've paused it for everyone while we look at something. Come back in a little while and try again.",
      }
    case "timeout":
      return {
        title: "That run took too long",
        description: "We stopped waiting rather than keep you here. Try again.",
      }
    case "provider_unavailable":
      return {
        title: "That run didn't finish",
        description:
          "Something on our side stopped responding before we could count anything. Try again in a moment.",
      }
    case "unreadable_source":
    case "unknown":
      return {
        title: "That run didn't work",
        description: "We're not sure why. Try again in a moment.",
      }
  }
}

const START_REFUSALS: Record<string, SignalsMessage> = {
  INVALID: {
    title: "Your ideal customer isn't finished",
    description:
      "Go back to the job titles step and add at least one title, so we know who to look for.",
  },
  RATE_LIMITED: {
    title: "That's a lot of runs in a row",
    description: "Give it a minute and try again.",
  },
  FORBIDDEN: {
    title: "You can't change this agent",
    description:
      "This account can't edit this organization's agent, so the chosen signals can't be saved here.",
  },
  UNAUTHENTICATED: {
    title: "Your session expired",
    description: "Sign in again and pick up where you left off.",
  },
  NOT_FOUND: {
    title: "This organization has no agent yet",
    description: "Reload the page and setup will make one.",
  },
}

const START_FALLBACK: SignalsMessage = {
  title: "We couldn't start that run",
  description: "Try again in a moment.",
}

export function startRecommendationCopy(error: unknown): SignalsMessage {
  const code = domainErrorCode(error)
  return code === undefined
    ? START_FALLBACK
    : (START_REFUSALS[code] ?? START_FALLBACK)
}

export function confirmBlockCopy(
  reason: "no_agent" | "no_enabled_strategy",
): SignalsMessage {
  return reason === "no_agent"
    ? {
        title: "This organization has no agent yet",
        description: "Reload the page and setup will make one.",
      }
    : {
        title: "Switch on at least one signal first",
        description:
          "Go back to the signals step and tick one that matches people. Your agent needs somewhere to start looking.",
      }
}

export const CONFIRM_FALLBACK: SignalsMessage = {
  title: "We couldn't finish setup",
  description:
    "Nothing was lost and nothing was charged. Try that again in a moment.",
}
