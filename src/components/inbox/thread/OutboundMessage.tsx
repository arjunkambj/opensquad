/**
 * One email of ours on the thread — a revision and what became of it.
 *
 * A draft that has not been sent never sits in the position or the style of a
 * sent message: a muted tint, its own word, and no send-looking badge. The card
 * below the thread is where it is approved; this is only the record.
 */
import {
  outboundStateLabel,
  type ThreadEntry,
} from "@/components/inbox/inbox-presentation"
import { MessageBody, MessageCard } from "@/components/inbox/thread/MessageCard"
import { Chip, type ChipVariant } from "@/components/kit/Chip"
import { formatInstant } from "@/lib/presentation"

const STATE_BADGE: Record<
  Extract<ThreadEntry, { kind: "outbound" }>["state"],
  { label: string; variant: ChipVariant }
> = {
  draft: { label: "Draft", variant: "accent" },
  pending: { label: "Sending", variant: "muted" },
  sent: { label: "Sent", variant: "success" },
  definitely_unsent: { label: "Not sent", variant: "destructive" },
  rejected: { label: "Rejected", variant: "destructive" },
  delivery_uncertain: { label: "Delivery uncertain", variant: "accent" },
}

export function OutboundMessage({
  entry,
  sender,
  recipient,
}: {
  entry: Extract<ThreadEntry, { kind: "outbound" }>
  sender: string
  recipient: string | undefined
}) {
  const isDraft = entry.state === "draft"
  const badge = STATE_BADGE[entry.state]
  return (
    <MessageCard
      sender={sender}
      badge={
        <Chip variant={badge.variant} className="px-2 py-0.5">
          {badge.label}
        </Chip>
      }
      meta={recipient === undefined ? undefined : `to ${recipient}`}
      time={formatInstant(entry.at)}
      className={isDraft ? "bg-muted/40" : undefined}
      footer={
        <p className="text-xs text-muted-foreground">
          {entry.bouncedAt !== undefined ? (
            <span className="text-destructive">
              Bounced {formatInstant(entry.bouncedAt)}.
            </span>
          ) : entry.deliveredAt !== undefined ? (
            `Delivered ${formatInstant(entry.deliveredAt)}.`
          ) : (
            outboundStateLabel(entry.state)
          )}
        </p>
      }
    >
      <MessageBody>{entry.body}</MessageBody>
    </MessageCard>
  )
}
