/**
 * One row of the Contacts table (ref 23): who they are, which signal found
 * them, what research thinks, whether we have an address, where they stand
 * and the decision that authorises contacting them.
 *
 * Presentational: every action is a callback the container owns.
 */
import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { FlameScore } from "@/components/kit/FlameScore"
import { Chip, formatWaited } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  APPROVAL_LABEL,
  decisionDisabledReason,
  emailDisabledReason,
  personName,
  researchDisabledReason,
  STAGE_LABEL,
  type ContactRowData,
  type SpendContext,
} from "../contacts-model"
import { EmailCell } from "./EmailCell"
import { RowMenu } from "./RowMenu"
import { SignalCell } from "./SignalCell"

export type ContactRowHandlers = {
  toggle: (prospectId: Id<"prospects">) => void
  open: (prospectId: Id<"prospects">) => void
  getEmail: (prospectId: Id<"prospects">) => void
  research: (prospectId: Id<"prospects">) => void
  approve: (prospectId: Id<"prospects">) => void
  reject: (prospectId: Id<"prospects">) => void
}

export function ContactRow({
  lead,
  selected,
  busy,
  spend,
  prices,
  handlers,
}: {
  lead: ContactRowData
  selected: boolean
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  handlers: ContactRowHandlers
}) {
  const name = personName(lead)
  const emailReason = emailDisabledReason(lead, prices.email, spend)
  const researchReason = researchDisabledReason(lead, prices.research, spend)
  const approveReason = decisionDisabledReason(lead, "approved")
  const rejectReason = decisionDisabledReason(lead, "rejected")

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell className="w-10 pl-4">
        <Checkbox
          aria-label={`Select ${name}`}
          checked={selected}
          onCheckedChange={() => handlers.toggle(lead._id)}
        />
      </TableCell>

      <TableCell className="max-w-72">
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              className="truncate text-left text-sm font-medium text-foreground hover:text-primary hover:underline"
              onClick={() => handlers.open(lead._id)}
            >
              {name}
            </button>
            {lead.linkedinUrl === undefined ? null : (
              <a
                href={lead.linkedinUrl}
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
            {lead.jobTitle ?? "Role unknown"}
          </span>
          {lead.companyName === undefined ? null : (
            <span className="truncate text-xs text-muted-foreground">
              @{lead.companyName}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell className="max-w-64">
        <SignalCell signals={lead.signals} />
      </TableCell>

      <TableCell>
        <FlameScore {...lead.research} />
      </TableCell>

      <TableCell>
        <EmailCell
          emailStatus={lead.emailStatus}
          {...(lead.email === undefined ? {} : { email: lead.email })}
          price={prices.email}
          disabledReason={emailReason}
          pending={busy}
          onGetEmail={() => handlers.getEmail(lead._id)}
        />
      </TableCell>

      <TableCell>
        <span title={lead.stageReason}>
          <Chip
            className={cn(
              lead.stage === "needs_attention" &&
                "bg-destructive/10 text-destructive",
            )}
          >
            {STAGE_LABEL[lead.stage]}
          </Chip>
        </span>
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {formatWaited(lead.createdAt)}
      </TableCell>

      <TableCell>
        {lead.approval === "pending" ? (
          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant="outline"
              disabled={busy || approveReason !== null}
              title={approveReason ?? undefined}
              onClick={() => handlers.approve(lead._id)}
            >
              Approve
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={busy || rejectReason !== null}
              title={rejectReason ?? undefined}
              onClick={() => handlers.reject(lead._id)}
            >
              Reject
            </Button>
          </div>
        ) : (
          <Chip
            className={cn(
              lead.approval === "approved" && "bg-primary/10 text-primary",
            )}
          >
            {APPROVAL_LABEL[lead.approval]}
          </Chip>
        )}
      </TableCell>

      <TableCell className="pr-4 text-right">
        <RowMenu
          name={name}
          open={() => handlers.open(lead._id)}
          {...(lead.linkedinUrl === undefined
            ? {}
            : { profileUrl: lead.linkedinUrl })}
          email={{
            label: `Get email · ${prices.email} credits`,
            disabledReason: busy ? "Working…" : emailReason,
            run: () => handlers.getEmail(lead._id),
          }}
          research={{
            label: `Research · ${prices.research} credits`,
            disabledReason: busy ? "Working…" : researchReason,
            run: () => handlers.research(lead._id),
          }}
          approve={{
            label: "Approve for outreach",
            disabledReason: busy ? "Working…" : approveReason,
            run: () => handlers.approve(lead._id),
          }}
          reject={{
            label: "Reject this lead",
            disabledReason: busy ? "Working…" : rejectReason,
            run: () => handlers.reject(lead._id),
          }}
        />
      </TableCell>
    </TableRow>
  )
}
