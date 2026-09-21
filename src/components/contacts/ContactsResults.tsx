/**
 * The loaded table and its footer, as one block.
 *
 * Presentational: it takes the page the container read and the handlers the
 * container owns, so the rows, the select-all, the sort header and the
 * pagination all speak about the same page and never read anything
 * themselves.
 */
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
  /** True in the one list mode the score order applies to. */
  sortable: boolean
  lowestScoreFirst: boolean
  onToggleSort: () => void
  onToggleAll: (checked: boolean) => void
  handlers: ContactRowHandlers
  /** What the footer counts from, and where it can go. */
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
