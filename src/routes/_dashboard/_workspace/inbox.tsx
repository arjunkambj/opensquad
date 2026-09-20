import { createFileRoute } from "@tanstack/react-router"
import { InboxLayout } from "@/components/inbox/InboxLayout"
import { oneOf, optionalCursor, pageSize } from "@/lib/search-params"

/**
 * The inbox's URL contract, declared on the layout so the list and the thread
 * share one definition — Back from a thread returns to the same tab and page
 * rather than to page one of `open`.
 *
 * `tab` is one of CONVERSATION_TABS — the only four slices the indexes back
 * (`by_workspaceId_and_state_and_lastMessageAt` and
 * `by_workspaceId_and_humanTakeover_and_lastMessageAt`). There is deliberately
 * no `q`: no inbox search query exists, and a control the backend cannot
 * honour is a lie. `cursor` and `limit` carry paging in the URL because a
 * queue position is shared context (V09/V23).
 */
export type InboxSearch = {
  tab?: "open" | "unassigned" | "takeover" | "closed"
  cursor?: string
  limit?: 25 | 50
}

export const Route = createFileRoute("/_dashboard/_workspace/inbox")({
  validateSearch: (search): InboxSearch => {
    // Defaults are absent from the URL — a clean `/inbox` means the open tab,
    // first page, 25 rows.
    const tab = oneOf(
      ["open", "unassigned", "takeover", "closed"] as const,
      search.tab,
      "open",
    )
    return {
      tab: tab === "open" ? undefined : tab,
      cursor: optionalCursor(search.cursor),
      limit: pageSize(search.limit),
    }
  },
  component: InboxLayout,
})
