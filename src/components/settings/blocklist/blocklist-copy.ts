/**
 * How a blocklist row is named on screen.
 *
 * The reason is a fact about where the row came from, and the four sources
 * mean different things to the reader: three of them were written by the
 * backend from something that actually happened, and only one was typed by a
 * person. Saying which is what makes "remove" a safe offer.
 */
import type { Doc } from "../../../../convex/_generated/dataModel"

export type SuppressionReason = Doc<"suppressions">["reason"]

export const BLOCK_REASON_LABEL: Record<SuppressionReason, string> = {
  unsubscribe: "Asked to stop",
  manual: "Added by hand",
  bounce: "Mail bounced",
  provider: "Reported by the mail provider",
}

export const BLOCK_KIND_LABEL: Record<Doc<"suppressions">["kind"], string> = {
  email: "Address",
  domain: "Whole domain",
}
