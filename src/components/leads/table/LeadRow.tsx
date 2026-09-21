import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Id } from "../../../../convex/_generated/dataModel"
import { Hint } from "@/components/kit/Hint"
import { FlameScore } from "@/components/kit/FlameScore"
import { stageChipVariant } from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
import { formatWaited } from "@/lib/presentation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  APPROVAL_LABEL,
  decisionDisabledReason,
  emailDisabledReason,
  personName,
  researchDisabledReason,
  STAGE_LABEL,
  type LeadRowData,
  type SpendContext,
} from "../leads-model"
import { EmailCell } from "./EmailCell"
import { RowMenu } from "./RowMenu"
import { SignalCell } from "./SignalCell"

export type LeadRowHandlers = {
  toggle: (prospectId: Id<"prospects">) => void
  open: (prospectId: Id<"prospects">) => void
  getEmail: (prospectId: Id<"prospects">) => void
  research: (prospectId: Id<"prospects">) => void
  approve: (prospectId: Id<"prospects">) => void
  reject: (prospectId: Id<"prospects">) => void
}

export function LeadRow({
  lead,
  selected,
  busy,
  spend,
  prices,
  handlers,
}: {
  lead: LeadRowData
  selected: boolean
  busy: boolean
  spend: SpendContext
  prices: { email: number; research: number }
  handlers: LeadRowHandlers
}) {
  const name = personName(lead)
  const emailReason = emailDisabledReason(lead, prices.email, spend)
  const researchReason = researchDisabledReason(lead, prices.research, spend)
  const approveReason = decisionDisabledReason(lead, "approved")
  const rejectReason = decisionDisabledReason(lead, "rejected")
  // Approval authorises the reveal, so a lead without an address costs one.
  const approvalBuysEmail =
    lead.emailStatus !== "found" &&
    lead.emailStatus !== "not_found" &&
    lead.emailStatus !== "revealing"

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell className="w-10">
        <div className="flex items-center pl-2">
          <Checkbox
            aria-label={`Select ${name}`}
            checked={selected}
            onCheckedChange={() => handlers.toggle(lead._id)}
          />
        </div>
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
        <Hint content={lead.stageReason}>
          <Chip variant={stageChipVariant(lead.stage)}>
            {STAGE_LABEL[lead.stage]}
          </Chip>
        </Hint>
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {formatWaited(lead.createdAt)}
      </TableCell>

      <TableCell>
        {lead.approval === "pending" ? (
          <div className="flex gap-1.5">
            <Hint
              content={
                approveReason ??
                (approvalBuysEmail
                  ? `Lets your agent find this person's email (${prices.email} credits) and draft an outreach email for you to review. Nothing is sent yet.`
                  : "Lets your agent draft an outreach email for you to review. Nothing is sent yet.")
              }
            >
              <Button
                size="xs"
                variant="outline"
                disabled={busy || approveReason !== null}
                onClick={() => handlers.approve(lead._id)}
              >
                Approve
                {approvalBuysEmail ? (
                  <span className="text-muted-foreground">
                    · {prices.email} cr
                  </span>
                ) : null}
              </Button>
            </Hint>
            <Hint
              content={
                rejectReason ??
                "Skip this lead. Your agent won't research or contact them."
              }
            >
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || rejectReason !== null}
                onClick={() => handlers.reject(lead._id)}
              >
                Reject
              </Button>
            </Hint>
          </div>
        ) : (
          <Chip variant={lead.approval === "approved" ? "success" : "muted"}>
            {APPROVAL_LABEL[lead.approval]}
          </Chip>
        )}
      </TableCell>

      <TableCell className="text-right">
        <div className="pr-2">
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
        </div>
      </TableCell>
    </TableRow>
  )
}
