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
