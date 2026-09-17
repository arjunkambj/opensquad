import { Outlet, createFileRoute } from "@tanstack/react-router"
import { SALES_STAGES } from "../../../../convex/lib/validators"
import type { SalesStage } from "../../../../convex/lib/validators"
import {
  DUE_WINDOW_IDS,
  type DueWindowId,
} from "@/lib/date-ranges"
import {
  optionalCursor,
  optionalId,
  optionalOneOf,
  optionalText,
  pageSize,
  type PageSize,
} from "@/lib/search-params"

/**
 * The CRM's URL contract, declared once on the layout so the list and the
 * lead detail cannot drift — the same arrangement `decisions.tsx` uses.
 * The detail inherits every list param, which is what makes "back to leads"
 * return to the same mode, filter and page rather than to page one of an
 * unfiltered list.
 *
 * The params and what each one is FOR — a value the backend cannot honour is
 * never sent (`plan/ux.md` §225 forbids a filter that silently post-filters):
 *
 * - `mode` — `pipeline` (stage-ordered list) or `due` (next-action worklist).
 * - `stage`, `campaign` — pipeline filters; legal in search mode too. Never
 *   sent in due mode — no index supports owner/due + stage, and a disabled
 *   control keeps its value visible rather than being dropped from the URL.
 * - `owner` — one member's `ownerIdentityKey`; legal in due mode and in
 *   search, not in pipeline mode.
 * - `due` — the due-mode lens: `overdue | today | next_7d | next_30d |
 *   unscheduled`. Absent in due mode means "everything with a due date".
 * - `q` — company-name search text. Non-empty switches the list to
 *   `prospects.search`; due windows never combine with it.
 * - `cursor`, `limit` — pagination; `withFilters` drops the cursor on every
 *   filter change.
 * - `tab` — the lead detail's section; meaningless on the list and ignored
 *   there.
 */
export type LeadListMode = "pipeline" | "due"

export type LeadTabId =
  | "overview"
  | "evidence"
  | "activity"
  | "conversation"
  | "booking"

export const LEAD_TAB_IDS: readonly LeadTabId[] = [
  "overview",
  "evidence",
  "activity",
  "conversation",
  "booking",
]

export type LeadsSearch = {
  mode?: LeadListMode
  stage?: SalesStage
  campaign?: string
  owner?: string
  due?: DueWindowId
  q?: string
  cursor?: string
  limit?: PageSize
  tab?: LeadTabId
}

export const Route = createFileRoute("/_dashboard/_workspace/leads")({
  validateSearch: (search): LeadsSearch => ({
    mode: optionalOneOf(["pipeline", "due"] as const, search.mode),
    stage: optionalOneOf(SALES_STAGES, search.stage),
    campaign: optionalId(search.campaign),
    owner: optionalText(search.owner, 300),
    due: optionalOneOf(DUE_WINDOW_IDS, search.due),
    q: optionalText(search.q),
    cursor: optionalCursor(search.cursor),
    limit: pageSize(search.limit),
    tab: optionalOneOf(LEAD_TAB_IDS, search.tab),
  }),
  component: LeadsLayout,
})

function LeadsLayout() {
  return <Outlet />
}
