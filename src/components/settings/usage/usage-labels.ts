/** Labels describe user actions, never provider names or internal billing units. */
import type { PaidAction } from "../../../../convex/lib/prices"

export type UsageAction = PaidAction | "other"

export const USAGE_ACTION_LABEL: Record<UsageAction, string> = {
  analyze_website: "Website analysis",
  generate_icp: "Audience built",
  recommend_signals: "Signals suggested",
  generate_keywords: "Keywords generated",
  find_leads: "Lead search",
  research_lead: "Company research",
  get_email: "Email found",
  write_email: "Email written",
  handle_reply: "Reply handled",
  profile_company: "Company profiled",
  score_lead: "Lead scored",
  other: "Other work",
}

export type UsageOutcome = "billed" | "refunded" | "pending"

/**
 * What the outcome means to the person reading it. `pending` is PLAN §6's
 * held credit: the step is still out, so the credits are neither spent nor
 * back — saying either would be a number they could not reconcile.
 */
export const USAGE_OUTCOME_LABEL: Record<UsageOutcome, string> = {
  billed: "Spent",
  refunded: "Given back",
  pending: "Pending",
}
