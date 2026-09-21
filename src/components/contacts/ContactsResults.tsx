import type { Id } from "../../../convex/_generated/dataModel"
import type { PageSize } from "@/lib/search-params"
import type { ContactRowData, SpendContext } from "./contacts-model"
import type { ContactRowHandlers } from "./table/ContactRow"
import { ContactsTable } from "./table/ContactsTable"
import { TableFooterBar } from "./table/TableFooterBar"

export function ContactsResults({
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
  leads: readonly ContactRowData[]
  selected: ReadonlySet<Id<"prospects">>
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  sortable: boolean
  lowestScoreFirst: boolean
  onToggleSort: () => void
  onToggleAll: (checked: boolean) => void
  handlers: ContactRowHandlers
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
      <ContactsTable
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
