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

/** The list and thread share URL filters and pagination. Search supports company names only. */
export type InboxSearch = {
  pill?: Exclude<InboxPill, "received">
  q?: string
  cursor?: string
  limit?: PageSize
}

export const Route = createFileRoute("/_dashboard/_org/inbox")({
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
