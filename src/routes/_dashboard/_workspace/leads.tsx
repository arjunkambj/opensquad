import { Outlet, createFileRoute } from "@tanstack/react-router"
import { LEAD_STAGES } from "../../../../convex/lib/validators"
import type { LeadApproval, LeadStage } from "../../../../convex/lib/validators"
import {
  optionalCursor,
  optionalOneOf,
  optionalText,
  pageSize,
  type PageSize,
} from "@/lib/search-params"

/**
 * The leads URL contract, declared once on the layout.
 *
 * The params and what each one is FOR — a value the backend cannot honour is
 * never sent, because a filter must never silently post-filter a page:
 *
 * - `stage` — one lead stage, on `by_workspaceId_and_stage_and_updatedAt`.
 * - `approval` — the approval queue, on `by_workspaceId_and_approval`.
 * - `q` — company-name search text. Non-empty switches the list to
 *   `prospects.search`.
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

export type LeadsSearch = {
  stage?: LeadStage
  approval?: LeadApproval
  q?: string
  cursor?: string
  limit?: PageSize
}

export const Route = createFileRoute("/_dashboard/_workspace/leads")({
  validateSearch: (search): LeadsSearch => ({
    stage: optionalOneOf(LEAD_STAGES, search.stage),
    approval: optionalOneOf(LEAD_APPROVALS, search.approval),
    q: optionalText(search.q),
    cursor: optionalCursor(search.cursor),
    limit: pageSize(search.limit),
  }),
  component: LeadsLayout,
})

function LeadsLayout() {
  return <Outlet />
}
