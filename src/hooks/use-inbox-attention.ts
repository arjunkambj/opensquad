import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

/**
 * The shared "threads that need a person" count — `unassigned + openTakeover`.
 *
 * One hook, one query, so the sidebar badge and the Overview attention block
 * read the same number with byte-identical arguments — two sources for one
 * count is a defect.
 *
 * The buckets are NOT interchangeable: `unassigned` is every thread with no
 * linked lead; `openTakeover` is only the OPEN frozen ones — it does not
 * count the unassigned threads the takeover tab also lists. The tab's own
 * count is a strictly different set, so the tabs never wear these numbers.
 */
export function useInboxAttention(workspaceId: Id<"workspaces"> | undefined) {
  return useQuery(
    api.inbox.conversations.attentionCounts,
    workspaceId === undefined ? "skip" : { workspaceId },
  )
}
