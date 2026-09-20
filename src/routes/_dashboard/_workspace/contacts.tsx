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
 * - `q` — company-name search text. Non-empty switches the list to
 *   `prospects.search`.
 * - `lead` — the contact whose drawer is open (PLAN §5). A drawer over a
 *   filtered table is shared context: the link has to reopen the same row
 *   over the same page, so it travels in the URL and every filter change
 *   spreads it through rather than dropping it.
 * - `cursor`, `limit` — pagination; `withFilters` drops the cursor on every
 *   filter change.
 *
 * `stage` and `approval` are separate list modes because each has its own
 * index; the list sends whichever one is set, never both.
 */
const LEAD_APPROVALS: readonly LeadApproval[] = [
  "pending",
  "approved",
  "rejected",
]

export type ContactsSearch = {
  stage?: LeadStage
  approval?: LeadApproval
  q?: string
  lead?: string
  cursor?: string
  limit?: PageSize
}

export const Route = createFileRoute("/_dashboard/_workspace/contacts")({
  validateSearch: (search): ContactsSearch => ({
    stage: optionalOneOf(LEAD_STAGES, search.stage),
    approval: optionalOneOf(LEAD_APPROVALS, search.approval),
    q: optionalText(search.q),
    lead: optionalRecordId(search.lead),
    cursor: optionalCursor(search.cursor),
    limit: pageSize(search.limit),
  }),
  component: ContactsPage,
})
