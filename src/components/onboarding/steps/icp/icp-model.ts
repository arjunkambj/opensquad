import { ICP_GENERATION_STALE_AFTER_MS } from "../../../../../convex/agents/icpModel"
import type { Doc } from "../../../../../convex/_generated/dataModel"
import { ACTION_PRICES } from "../../../../../convex/lib/prices"
import type {
  AgentIcp,
  OperationErrorCode,
} from "../../../../../convex/lib/validators"

const ICP_GENERATION_CREDITS = ACTION_PRICES.generate_icp.credits

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

/** Display-only pricing: the ledger decides charges. An uncertain run may later settle and change the price. */
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

export function sameIcpDraft(a: IcpDraft, b: IcpDraft): boolean {
  return ICP_GROUPS.every(
    (group) =>
      a[group].length === b[group].length &&
      a[group].every((value, index) => value === b[group][index]),
  )
}
