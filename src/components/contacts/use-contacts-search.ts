/**
 * The Contacts URL, as a hook: the filters, the search box, the page the
 * table is on and the lead whose drawer is open.
 *
 * All of it lives in the URL because a filtered table with a lead open is
 * shared context — someone pastes that link to a colleague. The two pieces
 * that cannot are here in state and say so: the debounced search text, which
 * would otherwise write a history entry per keystroke, and the trail of page
 * cursors, which only this session ever had.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import type { PageSize } from "@/lib/search-params"
import type { ContactsSearch } from "@/routes/_dashboard/_workspace/contacts"
import { exclusiveFilters, withContactFilters } from "./contacts-model"

const CONTACTS_ROUTE = "/_dashboard/_workspace/contacts"

const DEFAULT_PAGE_SIZE: PageSize = 25

/** How long the search box waits before it becomes a query (and a URL). */
const SEARCH_DEBOUNCE_MS = 350

export function useContactsSearch() {
  const search = useSearch({ from: CONTACTS_ROUTE })
  const navigate = useNavigate()

  const [text, setText] = useState(search.q ?? "")
  /**
   * The cursor of each page already visited, so Previous can return to one.
   * `null` is page one, which has no cursor. A link opened straight onto a
   * later page has no trail, and the footer offers "start over" rather than a
   * Previous that would land somewhere else.
   */
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

    /** One filter at a time — the others are cleared with it. */
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
