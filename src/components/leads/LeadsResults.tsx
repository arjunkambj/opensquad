import type { Id } from "../../../convex/_generated/dataModel"
import type { PageSize } from "@/lib/search-params"
import type { LeadRowData, SpendContext } from "./leads-model"
import type { LeadRowHandlers } from "./table/LeadRow"
import { LeadsTable } from "./table/LeadsTable"
import { TableFooterBar } from "./table/TableFooterBar"

export function LeadsResults({
  leads,
  selected,
  busy,
  spend,
  prices,
  sortable,
  lowestScoreFirst,
  onToggleSort,
  onToggleAll,
  handlers,
  pagination,
}: {
  leads: readonly LeadRowData[]
  selected: ReadonlySet<Id<"prospects">>
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  sortable: boolean
  lowestScoreFirst: boolean
  onToggleSort: () => void
  onToggleAll: (checked: boolean) => void
  handlers: LeadRowHandlers
  pagination: {
    firstIndex: number
    total: { count: number; hasMore: boolean }
    pageSize: PageSize
    canGoBack: boolean
    canGoForward: boolean
    onPageSize: (size: PageSize) => void
    onBack: () => void
    onForward: () => void
  }
}) {
  return (
    <>
      <LeadsTable
        leads={leads}
        selected={selected}
        busy={busy}
        spend={spend}
        prices={prices}
        sortable={sortable}
        lowestScoreFirst={lowestScoreFirst}
        onToggleSort={onToggleSort}
        onToggleAll={onToggleAll}
        handlers={handlers}
      />
      <TableFooterBar
        noun="leads"
        shown={leads.length}
        firstIndex={pagination.firstIndex}
        total={pagination.total}
        pageSize={pagination.pageSize}
        canGoBack={pagination.canGoBack}
        canGoForward={pagination.canGoForward}
        onPageSize={pagination.onPageSize}
        onBack={pagination.onBack}
        onForward={pagination.onForward}
      />
    </>
  )
}
