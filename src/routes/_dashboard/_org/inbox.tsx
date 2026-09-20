import { createFileRoute } from "@tanstack/react-router"
import {
  INBOX_PILLS,
  type InboxPill,
} from "@/components/inbox/inbox-presentation"
import { InboxPage } from "@/components/inbox/InboxPage"
import {
  oneOf,
  optionalCursor,
  optionalText,
  pageSize,
  type PageSize,
} from "@/lib/search-params"

/**
 * The inbox's URL contract, declared on the layout so the list and the open
 * thread share one definition — Back from a thread returns to the same pill
 * and page rather than to page one of Received.
 *
 * - `pill` — one of the four slices of reference 24, each an index range in
 *   `inbox.inboxList.list`. `received` is the default and stays out of the URL.
 * - `q` — company-name search. It is the only text the backend can honour:
 *   a thread is reached through `prospects.search_company_name`, so message
 *   bodies and people's names are not searchable and the field says so.
 * - `cursor`, `limit` — paging, in the URL because a queue position is shared
 *   context. A search returns one bounded set and carries no cursor.
 */
export type InboxSearch = {
  pill?: Exclude<InboxPill, "received">
  q?: string
  cursor?: string
  limit?: PageSize
}

export const Route = createFileRoute("/_dashboard/_workspace/inbox")({
  validateSearch: (search): InboxSearch => {
    const pill = oneOf(INBOX_PILLS, search.pill, "received")
    const q = optionalText(search.q, 200)
    const cursor = optionalCursor(search.cursor)
    const limit = pageSize(search.limit)
    return {
      ...(pill === "received" ? {} : { pill }),
      ...(q === undefined ? {} : { q }),
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit }),
    }
  },
  component: InboxPage,
})
