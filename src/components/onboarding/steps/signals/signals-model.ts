/**
 * Onboarding dot 4, in the client's terms: where a recommendation stands,
 * what another run costs, and how a match count is read out loud.
 *
 * The words a failure is shown in live next door, in `signals-copy.ts`.
 */
import { STRATEGY_GENERATION_STALE_AFTER_MS } from "../../../../../convex/agents/strategiesModel"
import { ACTION_PRICES } from "../../../../../convex/lib/prices"
import type {
  GenerationStatus,
  OperationErrorCode,
} from "../../../../../convex/lib/validators"

/** What another run of the recommender costs once the free first one is gone. */
export const SIGNALS_GENERATION_CREDITS =
  ACTION_PRICES.recommend_signals.credits

/** "Generate more" keywords. Never free — there is no first-run discount on
 *  this one, which is why the button always states a price. */
export const KEYWORDS_GENERATION_CREDITS =
  ACTION_PRICES.generate_keywords.credits

/* ------------------------------------------------------------------ */
/* Where a run stands                                                   */
/* ------------------------------------------------------------------ */

export type SignalsGenerationView =
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

/** The agent's `strategyGeneration`, with "absent" and "lost" spelled out. */
export function signalsGenerationView(
  status: GenerationStatus | null,
): SignalsGenerationView {
  if (status === null) {
    return { state: "never" }
  }
  switch (status.state) {
    case "idle":
      return { state: "never" }
    case "generating":
      return Date.now() - status.startedAt > STRATEGY_GENERATION_STALE_AFTER_MS
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
 * the affordability check uses — never what is charged.
 */
export function signalsGenerationPrice(view: SignalsGenerationView): number {
  switch (view.state) {
    case "never":
      // Nothing has been bought for this org yet: the first run is free.
      return 0
    case "generating":
    case "stalled":
    case "ready":
      return SIGNALS_GENERATION_CREDITS
    case "failed":
      // A completed generation we could not use was still billed; every other
      // failure was refused before the model ran and left the free run intact.
      return view.code === "invalid_response" ? SIGNALS_GENERATION_CREDITS : 0
  }
}

/* ------------------------------------------------------------------ */
/* Reading a match count out loud                                       */
/* ------------------------------------------------------------------ */

/** The word beside a card's count. Singular matters: "1 matches" reads like
 *  a bug in a screen whose whole job is to be believed. */
export function matchCountLabel(count: number): string {
  return count === 1 ? "match" : "matches"
}

/** True when a strategy can be switched on at all. A strategy that matches
 *  nobody would spend a search on an empty page, and the server refuses it. */
export function strategyIsSelectable(matchCount: number): boolean {
  return matchCount > 0
}
