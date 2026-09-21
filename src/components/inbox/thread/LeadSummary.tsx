import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../../convex/_generated/api"
import type { Doc } from "../../../../convex/_generated/dataModel"
import { StageChip } from "@/components/inbox/inbox-presentation"
import { Button } from "@/components/ui/button"

type Detail = FunctionReturnType<typeof api.inbox.conversations.get>

export function LeadSummary({
  prospect,
  conversation,
}: {
  prospect: NonNullable<Detail["prospect"]>
  conversation: Doc<"conversations">
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {prospect.companyName ?? "Unnamed company"}
        </span>
        <StageChip stage={prospect.stage} />
        {conversation.lastInboundFrom === undefined ? null : (
          <span className="truncate text-xs text-muted-foreground">
            {conversation.lastInboundFrom}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        render={
          <Link to="/contacts" search={{ lead: prospect.prospectId }} />
        }
      >
        Open the lead
        <HugeiconsIcon
          icon={ArrowUpRight01Icon}
          strokeWidth={2}
          data-icon="inline-end"
          aria-hidden="true"
        />
      </Button>
    </div>
  )
}
