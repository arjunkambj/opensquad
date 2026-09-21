import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

/** Attention counts unassigned threads plus open threads under takeover.
 * These buckets are disjoint; the takeover tab includes a different set. */
export function useInboxAttention(orgId: Id<"orgs"> | undefined) {
  return useQuery(
    api.inbox.conversations.attentionCounts,
    orgId === undefined ? "skip" : { orgId },
  )
}
