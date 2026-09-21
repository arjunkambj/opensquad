import { domainErrorCode } from "@/lib/convex-error"
import type { DomainErrorCode } from "../../convex/lib/errors"
import type { OperationErrorCode } from "../../convex/lib/validators"

export type AnalysisMessage = {
  title: string
  description: string
}

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

/** Keep copy exhaustive over backend error codes, including currently unreachable refusals. */
const START_REFUSALS: Record<DomainErrorCode, AnalysisMessage> = {
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
  NOT_FOUND: {
    title: "That company profile isn't here",
    description:
      "Reload the page and try again, or fill your profile in yourself.",
  },
  ACCOUNT_RESTRICTED: {
    title: "This account can't run an analysis",
    description:
      "You can still fill your profile in yourself and carry on with setup.",
  },
  NO_ACTIVE_ORG: {
    title: "No organization is open",
    description: "Pick the organization you're working in, then try again.",
  },
  TRIAL_CAPACITY_REACHED: {
    title: "We're at capacity right now",
    description:
      "Try again in a little while, or fill your profile in yourself and carry on.",
  },
  NO_CREDIT_GRANT: {
    title: "This organization has no credits",
    description:
      "Website analysis is a paid step. Fill your profile in yourself and carry on with setup.",
  },
  INSUFFICIENT_CREDITS: {
    title: "No credits left for another analysis",
    description:
      "Your allowance for website analysis is used up. You can still fill your profile in yourself.",
  },
  TRIAL_LIMIT_REACHED: {
    title: "Your trial's analysis limit is reached",
    description:
      "Fill your profile in yourself and carry on — nothing else in setup is blocked.",
  },
  PLATFORM_PAUSED: {
    title: "Website analysis is paused right now",
    description:
      "We've paused it for everyone while we look at something. Fill your profile in yourself and carry on.",
  },
  PLATFORM_CAPACITY: {
    title: "Website analysis is at capacity today",
    description:
      "Try again tomorrow, or fill your profile in yourself and carry on with setup.",
  },
}

const START_FALLBACK: AnalysisMessage = {
  title: "We couldn't start the analysis",
  description:
    "Try again in a moment, or fill your profile in yourself and carry on.",
}

export function startAnalysisCopy(error: unknown): AnalysisMessage {
  const code = domainErrorCode(error)
  return code === undefined ? START_FALLBACK : START_REFUSALS[code]
}
