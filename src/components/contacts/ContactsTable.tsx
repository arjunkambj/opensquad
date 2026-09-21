import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Id } from "../../../convex/_generated/dataModel"
import { FlameScore } from "@/components/kit/FlameScore"
import { Hint } from "@/components/kit/Hint"
import {
  emailDisabledReason,
  personName,
  type LeadRowData,
  type SpendContext,
} from "@/components/leads/leads-model"
import { EmailCell } from "@/components/leads/table/EmailCell"
import { SignalCell } from "@/components/leads/table/SignalCell"
import { TableFrame } from "@/components/kit/PageSection"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function ContactsTable({
  contacts,
  selected,
  busy,
  spend,
  price,
  onToggle,
  onToggleAll,
  onOpen,
  onReveal,
}: {
  contacts: readonly LeadRowData[]
  selected: ReadonlySet<Id<"prospects">>
  busy: boolean
  spend: SpendContext
  price: number
  onToggle: (prospectId: Id<"prospects">) => void
  onToggleAll: (checked: boolean) => void
  onOpen: (prospectId: Id<"prospects">) => void
  onReveal: (prospectId: Id<"prospects">) => void
}) {
  const allSelected =
    contacts.length > 0 &&
    contacts.every((contact) => selected.has(contact._id))

  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <tr className="border-b">
            <TableHead className="w-10">
              <div className="flex items-center pl-2">
                <Checkbox
                  aria-label="Select every contact on this page"
                  checked={allSelected}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </div>
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>
              <Hint content="The search that found this person.">
                <span className="cursor-help underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
                  Signal
                </span>
              </Hint>
            </TableHead>
            <TableHead>AI score</TableHead>
            <TableHead className="text-right">
              <span className="pr-2">Email</span>
            </TableHead>
          </tr>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            const name = personName(contact)
            return (
              <TableRow
                key={contact._id}
                data-state={selected.has(contact._id) ? "selected" : undefined}
              >
                <TableCell className="w-10">
                  <div className="flex items-center pl-2">
                    <Checkbox
                      aria-label={`Select ${name}`}
                      checked={selected.has(contact._id)}
                      onCheckedChange={() => onToggle(contact._id)}
                    />
                  </div>
                </TableCell>
                <TableCell className="max-w-72">
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="truncate text-left text-sm font-medium text-foreground hover:text-primary hover:underline"
                        onClick={() => onOpen(contact._id)}
                      >
                        {name}
                      </button>
                      {contact.linkedinUrl === undefined ? null : (
                        <a
                          href={contact.linkedinUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={`Open ${name}'s profile`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <HugeiconsIcon
                            icon={LinkSquare02Icon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        </a>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {contact.jobTitle ?? "Role unknown"}
                    </span>
                    {contact.companyName === undefined ? null : (
                      <span className="truncate text-xs text-muted-foreground">
                        @{contact.companyName}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-64">
                  <SignalCell signals={contact.signals} />
                </TableCell>
                <TableCell>
                  <FlameScore {...contact.research} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="pr-2">
                    <EmailCell
                      emailStatus={contact.emailStatus}
                      price={price}
                      disabledReason={emailDisabledReason(
                        contact,
                        price,
                        spend,
                      )}
                      pending={busy}
                      onGetEmail={() => onReveal(contact._id)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableFrame>
  )
}
