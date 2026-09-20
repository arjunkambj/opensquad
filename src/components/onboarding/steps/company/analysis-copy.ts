/**
 * The ONE place a website-analysis failure becomes words.
 *
 * The backend stores a mapped code and never provider text (PLAN §4), so the
 * sentences a user reads are written here and nowhere else. Two doors in:
 * `analysisFailureCopy` for a run that finished badly, and
 * `startAnalysisCopy` for a request the server refused before a run began.
 *
 * Every message ends with something the user can do, because every one of
 * these states also offers Retry and "Fill in manually".
 */
import { ConvexError } from "convex/values"
import type { OperationErrorCode } from "../../../../../convex/lib/validators"

export type AnalysisMessage = {
  title: string
  description: string
}

/** A run that failed, by the code `businessProfiles.analysisStatus` stored. */
export function analysisFailureCopy(
  code: OperationErrorCode,
): AnalysisMessage {
  switch (code) {
    case "unreadable_source":
      return {
        title: "We couldn't read that website",
        description:
          "The site either blocked us or had nothing on it we could use. Check the address, try again, or fill your profile in yourself.",
      }
    case "not_found":
      return {
        title: "That address didn't lead anywhere",
        description:
          "Nothing answered at that website. Check it for a typo and try again, or fill your profile in yourself.",
      }
    case "timeout":
      return {
        title: "That website took too long to read",
        description:
          "We stopped waiting rather than keep you here. Try again, or fill your profile in yourself.",
      }
    case "invalid_response":
      return {
        title: "We read the site but couldn't build a profile from it",
        description:
          "There wasn't enough on those pages to describe what you sell. Try again, or write the profile yourself — you know it better anyway.",
      }
    case "rate_limited":
      return {
        title: "That's a lot of analyses in a row",
        description:
          "Give it a minute and try again, or fill your profile in yourself.",
      }
    case "insufficient_credits":
      return {
        title: "No credits left for another analysis",
        description:
          "Your trial allowance for website analysis is used up. You can still fill your profile in yourself and carry on with setup.",
      }
    case "platform_paused":
      return {
        title: "Website analysis is paused right now",
        description:
          "We've paused it for everyone while we look at something. Fill your profile in yourself and carry on — nothing else in setup is blocked.",
      }
    case "provider_unavailable":
      return {
        title: "Website analysis didn't finish",
        description:
          "Something on our side stopped responding. Try again in a moment, or fill your profile in yourself.",
      }
    case "unknown":
      return {
        title: "That analysis didn't work",
        description:
          "We're not sure why. Try again, or fill your profile in yourself.",
      }
  }
}

/** The codes `company.mutations.startAnalysis` refuses with. */
const START_REFUSALS: Record<string, AnalysisMessage> = {
  INVALID: {
    title: "That doesn't look like a website address",
    description:
      "Enter a public address such as yourcompany.com. Internal and local addresses can't be read.",
  },
  RATE_LIMITED: {
    title: "That's a lot of analyses in a row",
    description: "Give it a minute and try again.",
  },
  CONFLICT: {
    title: "An analysis is already running",
    description: "Wait for the one in progress to finish, then try again.",
  },
  FORBIDDEN: {
    title: "You can't change this company profile",
    description:
      "This account can't edit this organization's profile, so the website can't be analysed here.",
  },
  UNAUTHENTICATED: {
    title: "Your session expired",
    description: "Sign in again and pick up where you left off.",
  },
}

const START_FALLBACK: AnalysisMessage = {
  title: "We couldn't start the analysis",
  description:
    "Try again in a moment, or fill your profile in yourself and carry on.",
}

/** A refusal from the mutation itself, before any run began. */
export function startAnalysisCopy(error: unknown): AnalysisMessage {
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
