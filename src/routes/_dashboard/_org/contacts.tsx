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

/** Stage, approval and score select separate indexed list modes; only one may be active.
 * Keep the open lead in the URL, and reset pagination when filters change. */
const LEAD_APPROVALS: readonly LeadApproval[] = [
  "pending",
  "approved",
  "rejected",
]

export type LeadScoreFilter = 1 | 2 | 3

type ContactsSort = "lowest"

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

function optionalScore(value: unknown): LeadScoreFilter | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return parsed === 1 || parsed === 2 || parsed === 3 ? parsed : undefined
}

function pageNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" &&
    Number.isInteger(parsed) &&
    parsed > 1 &&
    parsed <= 1000
    ? parsed
    : undefined
}

/** The backend supports one indexed filter mode at a time. Company search cannot combine with score. */
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

export const Route = createFileRoute("/_dashboard/_org/contacts")({
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
