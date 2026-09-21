/**
 * Onboarding dot 2, in the client's terms: where a generation stands, what
 * another run costs, and the seven lists the three screens edit between them.
 *
 * The words a failure is shown in live next door, in `icp-copy.ts`.
 */
import { ICP_GENERATION_STALE_AFTER_MS } from "../../../../../convex/agents/icpModel"
import type { Doc } from "../../../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../../../convex/lib/prices"
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
      // Nothing has been bought for this org yet: the first run is free.
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
