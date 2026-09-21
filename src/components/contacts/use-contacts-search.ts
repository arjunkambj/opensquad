/** Pagination and the open lead live in the URL. Visited cursors stay local. */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { withFilters, type PageSize } from "@/lib/search-params"
import type { ContactsSearch } from "@/routes/_dashboard/_org/contacts"

const CONTACTS_ROUTE = "/_dashboard/_org/contacts"

const DEFAULT_PAGE_SIZE: PageSize = 25

export function useContactsSearch() {
  const search = useSearch({ from: CONTACTS_ROUTE })
  const navigate = useNavigate()
  /** Only visited pages have a Previous cursor. A deep link starts without that trail. */
  const [trail, setTrail] = useState<(string | null)[]>([])

  const goTo = (patch: Partial<ContactsSearch>) => {
    void navigate({
      to: "/contacts",
      search: (current: ContactsSearch) => ({ ...current, ...patch }),
    })
  }

  const pageNumber = search.page ?? 1

  return {
    search,
    limit: search.limit ?? DEFAULT_PAGE_SIZE,
    pageNumber,
    canGoBack: trail.length > 0,

    setPageSize: (size: PageSize) => {
      setTrail([])
      void navigate({
        to: "/contacts",
        search: (current: ContactsSearch) =>
          withFilters(current, { limit: size, page: undefined }),
      })
    },

    /** Back to page one, for a cursor that outlived the page it pointed at. */
    resetPaging: () => {
      setTrail([])
      goTo({ cursor: undefined, page: undefined })
    },

    goForward: (cursor: string) => {
      setTrail([...trail, search.cursor ?? null])
      goTo({ cursor, page: pageNumber + 1 })
    },

    goBack: () => {
      const previous = trail[trail.length - 1] ?? null
      setTrail(trail.slice(0, -1))
      goTo({
        cursor: previous ?? undefined,
        page: pageNumber <= 2 ? undefined : pageNumber - 1,
      })
    },

    openLead: (prospectId: Id<"prospects">) => goTo({ lead: prospectId }),
    closeLead: () => goTo({ lead: undefined }),
  }
}
