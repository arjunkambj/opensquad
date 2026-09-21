import { Hint } from "@/components/kit/Hint"
/** Score sorting applies only to the unfiltered list; filtered modes use their own index ordering. */
import { SortByDown01Icon, SortByUp01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { TableFrame } from "@/components/kit/PageSection"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
} from "@/components/ui/table"
import type { LeadRowData, SpendContext } from "../leads-model"
import { LeadRow, type LeadRowHandlers } from "./LeadRow"

export function LeadsTable({
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
}) {
  const allSelected =
    leads.length > 0 && leads.every((lead) => selected.has(lead._id))

  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <tr className="border-b">
            <TableHead className="w-10">
              <div className="flex items-center pl-2">
                <Checkbox
                  aria-label="Select every lead on this page"
                  checked={allSelected}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </div>
            </TableHead>
            <TableHead>Lead</TableHead>
            <TableHead>
              <Hint content="The search that found this person.">
                <span className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
                  Signal
                </span>
              </Hint>
            </TableHead>
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
            <TableHead>
              <Hint content="Where this lead is, from found and researched through contacted, replied and meeting booked. Hover a stage for why it is there.">
                <span className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
                  Stage
                </span>
              </Hint>
            </TableHead>
            <TableHead>Imported</TableHead>
            <TableHead>
              <Hint content="Nothing goes out until you approve a lead — unless Autopilot is on and it clears your score.">
                <span className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
                  Approval
                </span>
              </Hint>
            </TableHead>
            <TableHead className="text-right">
              <span className="pr-2">Actions</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <LeadRow
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
    </TableFrame>
  )
}
