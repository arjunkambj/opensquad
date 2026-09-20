/**
 * Onboarding dot 2, in the client's terms: what the three ICP screens share.
 *
 * The ONE place a generation failure becomes words — the backend stores a
 * mapped code and never provider text (PLAN §4) — plus the two small
 * questions every screen asks: what does another run cost, and has anything
 * been generated yet.
 */
import { ConvexError } from "convex/values"
import { ICP_GENERATION_STALE_AFTER_MS } from "../../../../../convex/agents/icpModel"
import type { Doc } from "../../../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../../../convex/lib/limits"
import type {
  AgentIcp,
  OperationErrorCode,
} from "../../../../../convex/lib/validators"

/** What a regeneration costs once the free first run is gone. */
export const ICP_GENERATION_CREDITS = ACTION_PRICES.generate_icp.credits

/* ------------------------------------------------------------------ */
/* Where a run stands                                                   */
/* ------------------------------------------------------------------ */

export type IcpGenerationView =
  | { state: "never" }
  | { state: "generating" }
  /**
   * Still marked as running long after it should have reported. The action
   * always reports back, so this only happens when the deployment lost the
   * scheduled call — and it is the difference between a screen that loads
   * forever and one that offers a way out.
   */
  | { state: "stalled" }
  | { state: "ready" }
  | { state: "failed"; code: OperationErrorCode }

/** The agent's `icpGeneration`, with "absent" and "lost" spelled out. */
export function icpGenerationView(agent: Doc<"agents">): IcpGenerationView {
  const status = agent.icpGeneration
  if (status === undefined) {
    return { state: "never" }
  }
  switch (status.state) {
    case "idle":
      return { state: "never" }
    case "generating":
      return Date.now() - status.startedAt > ICP_GENERATION_STALE_AFTER_MS
        ? { state: "stalled" }
        : { state: "generating" }
    case "ready":
      return { state: "ready" }
    case "failed":
      return { state: "failed", code: status.code }
  }
}

/**
 * What the NEXT run will cost, as far as the browser can tell.
 *
 * The ledger is the authority (`billing/reserve.ts` prices from the first
 * settled operation, not from this), so this is what the button says and what
 * the affordability check uses — never what is charged. The one case it can
 * read wrong is a run whose outcome is still `uncertain`: it shows free, and
 * if the sweep later commits it the server charges and says so.
 */
export function icpGenerationPrice(view: IcpGenerationView): number {
  switch (view.state) {
    case "never":
      // Nothing has been bought for this workspace yet: the first run is free.
      return 0
    case "generating":
    case "stalled":
    case "ready":
      return ICP_GENERATION_CREDITS
    case "failed":
      // A completed generation we could not use was still billed; every other
      // failure was refused before the model ran and left the free run intact.
      return view.code === "invalid_response" ? ICP_GENERATION_CREDITS : 0
  }
}

/* ------------------------------------------------------------------ */
/* Failures, in our own words                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* The draft itself                                                     */
/* ------------------------------------------------------------------ */

/** The seven lists the three screens edit between them. */
export type IcpDraft = AgentIcp

const ICP_GROUPS = [
  "jobTitles",
  "industries",
  "locations",
  "companyTypes",
  "companySizes",
  "excludeProfiles",
  "excludeKeywords",
] as const satisfies readonly (keyof IcpDraft)[]

/** True when two drafts say the same thing, so a debounce that fired with
 *  nothing new can skip the round trip. */
export function sameIcpDraft(a: IcpDraft, b: IcpDraft): boolean {
  return ICP_GROUPS.every(
    (group) =>
      a[group].length === b[group].length &&
      a[group].every((value, index) => value === b[group][index]),
  )
}
