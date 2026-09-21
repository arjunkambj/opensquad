/** Filters and the open lead live in the URL. Debounced text and visited cursors stay local. */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import type { PageSize } from "@/lib/search-params"
import type { ContactsSearch } from "@/routes/_dashboard/_org/contacts"
import { exclusiveFilters, withContactFilters } from "./contacts-model"

const CONTACTS_ROUTE = "/_dashboard/_org/contacts"

const DEFAULT_PAGE_SIZE: PageSize = 25

const SEARCH_DEBOUNCE_MS = 350

export function useContactsSearch() {
  const search = useSearch({ from: CONTACTS_ROUTE })
  const navigate = useNavigate()

  const [text, setText] = useState(search.q ?? "")
  /** Only visited pages have a Previous cursor. A deep link starts without that trail. */
  const [trail, setTrail] = useState<(string | null)[]>([])

  const goTo = (patch: Partial<ContactsSearch>) => {
    void navigate({
      to: "/contacts",
      search: (current: ContactsSearch) => ({ ...current, ...patch }),
    })
  }

  // The search box types faster than a query should run.
  useEffect(() => {
    const trimmed = text.trim()
    if (trimmed === (search.q ?? "")) {
      return
    }
    const timer = setTimeout(() => {
      setTrail([])
      void navigate({
        to: "/contacts",
        search: (current: ContactsSearch) =>
          withContactFilters(current, {
            q: trimmed === "" ? undefined : trimmed,
          }),
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [navigate, search.q, text])

  const limit = search.limit ?? DEFAULT_PAGE_SIZE
  const pageNumber = search.page ?? 1
  const filtered =
    search.q !== undefined ||
    search.stage !== undefined ||
    search.approval !== undefined ||
    search.score !== undefined

  return {
    search,
    text,
    setText,
    limit,
    pageNumber,
    filtered,
    canGoBack: trail.length > 0,

    applyFilter: (patch: Partial<ContactsSearch>) => {
      setTrail([])
      // The company-search index filters on stage and approval only, so
      // asking for a score means leaving the search rather than pretending
      // both hold.
      const applied =
        patch.score === undefined ? patch : { ...patch, q: undefined }
      if ("q" in applied) {
        setText(applied.q ?? "")
      }
      void navigate({
        to: "/contacts",
        search: (current: ContactsSearch) =>
          withContactFilters(current, exclusiveFilters(applied)),
      })
    },

    setPageSize: (size: PageSize) => {
      setTrail([])
      void navigate({
        to: "/contacts",
        search: (current: ContactsSearch) =>
          withContactFilters(current, { limit: size }),
      })
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
