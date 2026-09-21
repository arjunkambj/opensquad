import { Link } from "@tanstack/react-router"
import {
  DispositionChip,
  NeedsApprovalChip,
  StageChip,
  leadDisplayName,
  type InboxRowData,
} from "@/components/inbox/inbox-presentation"
import { formatWaited } from "@/lib/presentation"
import { cn } from "@/lib/utils"
import type { InboxSearch } from "@/routes/_dashboard/_org/inbox"

export function ConversationRow({
  row,
  search,
  onFocus,
}: {
  row: InboxRowData
  search: InboxSearch
  onFocus: () => void
}) {
  const unread = row.unreadCount > 0
  const at = row.lastInboundAt ?? row.lastMessageAt
  const title =
    row.lead === null
      ? (row.lastInboundFrom ?? "Unmatched reply")
      : leadDisplayName(row.lead)
  const company = row.lead?.companyName

  return (
    <Link
      to="/inbox/$conversationId"
      params={{ conversationId: row.conversationId }}
      search={search}
      data-queue-item={row.conversationId}
      onFocus={onFocus}
      activeProps={{ "data-active": "true" }}
      className={cn(
        "flex flex-col gap-1.5 rounded-2xl px-3 py-2.5 outline-none transition-colors",
        "hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/30",
        "data-[active=true]:bg-sidebar-accent",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        {unread ? (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-primary"
          />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            unread ? "font-semibold text-foreground" : "text-foreground",
          )}
        >
          {title}
          {unread ? (
            <span className="sr-only"> — {row.unreadCount} unread</span>
          ) : null}
        </span>
        {at === undefined ? null : (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatWaited(at)}
          </span>
        )}
      </div>

      {company === undefined ? null : (
        <span className="truncate text-xs text-muted-foreground">
          {company}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {row.awaitingApproval ? <NeedsApprovalChip /> : null}
        {row.lastDisposition === undefined ? null : (
          <DispositionChip disposition={row.lastDisposition} />
        )}
        {row.lead === null ? null : <StageChip stage={row.lead.stage} />}
      </div>
    </Link>
  )
}
