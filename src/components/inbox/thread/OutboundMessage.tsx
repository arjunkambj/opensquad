/**
 * One email of ours on the thread — a revision and what became of it.
 *
 * A draft that has not been sent never sits in the position or the style of a
 * sent message: dashed, its own word, and no send-looking badge. The card
 * below the thread is where it is approved; this is only the record.
 */
import {
  outboundStateLabel,
  type ThreadEntry,
} from "@/components/inbox/inbox-presentation"
import { Chip, formatInstant } from "@/components/shared/presentation"
import { cn } from "@/lib/utils"

export function OutboundMessage({
  entry,
  pending,
}: {
  entry: Extract<ThreadEntry, { kind: "outbound" }>
  pending: boolean
}) {
  const isDraft = entry.state === "draft"
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] px-4 py-3",
        isDraft
          ? "border border-dashed border-border"
          : "bg-muted/60",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <Chip className={isDraft ? undefined : "bg-chart-2/15 text-chart-2"}>
          {isDraft ? "Draft" : "Sent by your agent"}
        </Chip>
        <span className="text-xs text-muted-foreground">
          {outboundStateLabel(entry.state)}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatInstant(entry.at)}
        </span>
      </header>
      <p className="text-sm font-medium text-foreground">{entry.subject}</p>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {entry.body}
      </p>
      {entry.deliveredAt === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          Delivery confirmed {formatInstant(entry.deliveredAt)}.
        </p>
      )}
      {entry.bouncedAt === undefined ? null : (
        <p className="text-xs text-destructive">
          Bounced {formatInstant(entry.bouncedAt)}.
        </p>
      )}
      {pending && isDraft ? (
        <p className="text-xs text-muted-foreground">
          This is the reply waiting below — edit or approve it there.
        </p>
      ) : null}
    </li>
  )
}
