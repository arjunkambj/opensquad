import { Link } from "@tanstack/react-router"
import {
  DispositionChip,
  NeedsApprovalChip,
  PersonAvatar,
  parseSender,
  StageChip,
  leadDisplayName,
  type InboxRowData,
} from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
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
  const sender =
    row.lastInboundFrom === undefined ? undefined : parseSender(row.lastInboundFrom)
  const title =
    row.lead === null
      ? (sender?.name ?? "Unmatched reply")
      : leadDisplayName(row.lead)
  // The line under the name: the lead's company, else the sender's address
  // when the name hides it.
  const subline =
    row.lead === null
      ? sender?.address !== undefined && sender.address !== title
        ? sender.address
        : undefined
      : row.lead.companyName

  return (
    <Link
      to="/inbox/$conversationId"
      params={{ conversationId: row.conversationId }}
      search={search}
      data-queue-item={row.conversationId}
      onFocus={onFocus}
      activeProps={{ "data-active": "true" }}
      className={cn(
        "relative flex gap-3 px-4 py-3 outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:ring-inset",
        "data-[active=true]:bg-muted",
      )}
    >
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-1.5 size-1.5 -translate-y-1/2 rounded-full bg-primary"
        />
      ) : null}
      <PersonAvatar name={title} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm text-foreground",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {title}
            {unread ? (
              <span className="sr-only"> — {row.unreadCount} unread</span>
            ) : null}
          </span>
          {at === undefined ? null : (
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums",
                unread ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {formatWaited(at)}
            </span>
          )}
        </div>

        {subline === undefined || subline === title ? null : (
          <span className="truncate text-xs text-muted-foreground">
            {subline}
          </span>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {row.awaitingApproval ? <NeedsApprovalChip /> : null}
          {row.lastDisposition === undefined ? null : (
            <DispositionChip disposition={row.lastDisposition} />
          )}
          {row.lead === null ? (
            <Chip>No lead linked</Chip>
          ) : (
            <StageChip stage={row.lead.stage} />
          )}
          {row.humanTakeover ? <Chip variant="accent">Agent paused</Chip> : null}
          {row.state === "closed" ? <Chip>Closed</Chip> : null}
        </div>
      </div>
    </Link>
  )
}
