/** Score sorting applies only to the unfiltered list; filtered modes use their own index ordering. */
import { SortByDown01Icon, SortByUp01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ContactRowData, SpendContext } from "../contacts-model"
import { ContactRow, type ContactRowHandlers } from "./ContactRow"

export function ContactsTable({
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
}) {
  const allSelected =
    leads.length > 0 && leads.every((lead) => selected.has(lead._id))

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="w-10 pl-4">
              <Checkbox
                aria-label="Select every lead on this page"
                checked={allSelected}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
              />
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Signal</TableHead>
            <TableHead>
              {sortable ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-foreground hover:text-primary"
                  onClick={onToggleSort}
                  aria-label={
                    lowestScoreFirst
                      ? "Sort by best AI score first"
                      : "Sort by lowest AI score first"
                  }
                >
                  AI score
                  <HugeiconsIcon
                    icon={lowestScoreFirst ? SortByUp01Icon : SortByDown01Icon}
                    strokeWidth={2}
                    className="size-3.5"
                  />
                </button>
              ) : (
                "AI score"
              )}
            </TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Imported</TableHead>
            <TableHead>Approval</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <ContactRow
              key={lead._id}
              lead={lead}
              selected={selected.has(lead._id)}
              busy={busy}
              spend={spend}
              prices={prices}
              handlers={handlers}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
