import { createFileRoute } from "@tanstack/react-router"
import { LEAD_STAGES } from "../../../../convex/lib/validators"
import type { LeadApproval, LeadStage } from "../../../../convex/lib/validators"
import { ContactsPage } from "@/components/contacts/ContactsPage"
import {
  optionalCursor,
  optionalOneOf,
  optionalRecordId,
  optionalText,
  pageSize,
  type PageSize,
} from "@/lib/search-params"

/**
 * The contacts URL contract, declared once on the route.
 *
 * The params and what each one is FOR — a value the backend cannot honour is
 * never sent, because a filter must never silently post-filter a page:
 *
 * - `stage` — one lead stage, on `by_workspaceId_and_stage_and_updatedAt`.
 * - `approval` — the approval queue, on `by_workspaceId_and_approval`.
 * - `score` — one flame score, on `by_workspaceId_and_scoreKey`.
 * - `q` — company-name search text, on `search_company_name`.
 * - `sort` — `lowest` flips the default best-score-first order. It applies to
 *   the unfiltered list; every other mode has the order its own index gives.
 * - `lead` — the contact whose drawer is open (PLAN §5). A drawer over a
 *   filtered table is shared context: the link has to reopen the same row
 *   over the same page, so it travels in the URL and every filter change
 *   spreads it through rather than dropping it.
 * - `cursor`, `page`, `limit` — pagination. `page` is what the footer counts
 *   from; it moves with the cursor and is dropped with it on any filter
 *   change.
 *
 * `stage`, `approval` and `score` are separate list modes because each has its
 * own index; the list sends whichever one is set, never two.
 */
const LEAD_APPROVALS: readonly LeadApproval[] = [
  "pending",
  "approved",
  "rejected",
]

export type LeadScoreFilter = 1 | 2 | 3

export type ContactsSort = "lowest"

export type ContactsSearch = {
  stage?: LeadStage
  approval?: LeadApproval
  score?: LeadScoreFilter
  q?: string
  sort?: ContactsSort
  lead?: string
  cursor?: string
  page?: number
  limit?: PageSize
}

/** One flame score, or absent. Anything else falls back to "every score". */
function optionalScore(value: unknown): LeadScoreFilter | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : undefined
}

/**
 * The 1-based page the footer counts from. Only a whole page number within a
 * sane range survives; a hand-edited link falls back to page one, which is
 * also the only page a bare path can mean.
 */
function pageNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" &&
    Number.isInteger(parsed) &&
    parsed > 1 &&
    parsed <= 1000
    ? parsed
    : undefined
}

/**
 * The one active filter, by precedence.
 *
 * The backend refuses a combination no index supports, so a hand-edited link
 * carrying two of them would otherwise make the page throw. Narrowing here
 * means a pasted URL always opens: it is simply read as the narrowest filter
 * it names. `score` is not a filter field of the company-search index, so a
 * search drops it rather than silently returning unscored matches.
 */
function oneFilter(search: Record<string, unknown>, searching: boolean) {
  const score = searching ? undefined : optionalScore(search.score)
  if (score !== undefined) {
    return { score }
  }
  const approval = optionalOneOf(LEAD_APPROVALS, search.approval)
  if (approval !== undefined) {
    return { approval }
  }
  const stage = optionalOneOf(LEAD_STAGES, search.stage)
  return stage === undefined ? {} : { stage }
}

export const Route = createFileRoute("/_dashboard/_workspace/contacts")({
  validateSearch: (search): ContactsSearch => {
    const q = optionalText(search.q)
    return {
      ...oneFilter(search, q !== undefined),
      q,
      sort: optionalOneOf(["lowest"] as const, search.sort),
      lead: optionalRecordId(search.lead),
      cursor: optionalCursor(search.cursor),
      page: pageNumber(search.page),
      limit: pageSize(search.limit),
    }
  },
  component: ContactsPage,
})
