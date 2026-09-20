/**
 * The ONE place an ICP generation failure becomes words.
 *
 * The backend stores a mapped code and never provider text (PLAN §4), so the
 * sentences a user reads are written here and nowhere else. Two doors in:
 * `icpFailureCopy` for a run that finished badly, and `startGenerationCopy`
 * for a request the server refused before a run began.
 *
 * Every message ends with something the user can do, because every one of
 * these states also offers Try again and "Fill it in myself".
 */
import { ConvexError } from "convex/values"
import type { OperationErrorCode } from "../../../../../convex/lib/validators"

export type IcpMessage = {
  title: string
  description: string
}

/** A run that failed, by the code `agents.icpGeneration` stored. */
export function icpFailureCopy(code: OperationErrorCode): IcpMessage {
  switch (code) {
    case "invalid_response":
      return {
        title: "We couldn't turn your profile into a customer description",
        description:
          "The answer didn't come back in a shape we could use. Try again, or fill it in yourself — you know your buyers better anyway.",
      }
    case "not_found":
      return {
        title: "Your company profile has gone",
        description:
          "There was nothing to read your ideal customer from. Go back a step, check the profile, then try again.",
      }
    case "rate_limited":
      return {
        title: "That's a lot of runs in a row",
        description:
          "Give it a minute and try again, or fill it in yourself and carry on.",
      }
    case "insufficient_credits":
      return {
        title: "No credits left for another run",
        description:
          "Your trial allowance for this step is used up. You can still fill it in yourself and carry on with setup.",
      }
    case "platform_paused":
      return {
        title: "This step is paused right now",
        description:
          "We've paused it for everyone while we look at something. Fill it in yourself and carry on — nothing else in setup is blocked.",
      }
    case "timeout":
      return {
        title: "That run took too long",
        description:
          "We stopped waiting rather than keep you here. Try again, or fill it in yourself.",
      }
    case "provider_unavailable":
      return {
        title: "That run didn't finish",
        description:
          "Something on our side stopped responding. Try again in a moment, or fill it in yourself.",
      }
    case "unreadable_source":
    case "unknown":
      return {
        title: "That run didn't work",
        description:
          "We're not sure why. Try again, or fill it in yourself and carry on.",
      }
  }
}

/** The codes `agents.icp.startGeneration` refuses with. */
const START_REFUSALS: Record<string, IcpMessage> = {
  INVALID: {
    title: "Your company profile isn't finished",
    description:
      "Go back to the first step and add a name, industry, description and at least one key feature.",
  },
  RATE_LIMITED: {
    title: "That's a lot of runs in a row",
    description: "Give it a minute and try again.",
  },
  FORBIDDEN: {
    title: "You can't change this agent",
    description:
      "Describing the ideal customer edits the workspace's agent, which needs an owner or operator role.",
  },
  UNAUTHENTICATED: {
    title: "Your session expired",
    description: "Sign in again and pick up where you left off.",
  },
  CONFLICT: {
    title: "We can't run this yet",
    description:
      "The list of industries and locations we match against hasn't loaded. Try again in a moment.",
  },
}

const START_FALLBACK: IcpMessage = {
  title: "We couldn't start that run",
  description: "Try again in a moment, or fill it in yourself and carry on.",
}

/** A refusal from the mutation itself, before any run began. */
export function startGenerationCopy(error: unknown): IcpMessage {
  if (error instanceof ConvexError) {
    const data: unknown = error.data
    if (typeof data === "object" && data !== null) {
      const code = (data as { code?: unknown }).code
      if (typeof code === "string") {
        return START_REFUSALS[code] ?? START_FALLBACK
      }
    }
  }
  return START_FALLBACK
}
