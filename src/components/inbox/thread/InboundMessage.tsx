/**
 * One reply the lead sent.
 *
 * A message whose body we do not hold says so. Connecting an inbox imports
 * the recent threads' identities, senders and timestamps but not their text,
 * so an imported message has a header and nothing under it — and an empty
 * body is never filled in with a summary or a guess.
 */
import type { MessageSource } from "../../../../convex/lib/validators"
import {
  parseSender,
  type ThreadEntry,
} from "@/components/inbox/inbox-presentation"
import { MessageBody, MessageCard } from "@/components/inbox/thread/MessageCard"
import { formatInstant } from "@/lib/presentation"

export function InboundMessage({
  entry,
  source,
}: {
  entry: Extract<ThreadEntry, { kind: "inbound" }>
  source: MessageSource
}) {
  const sender =
    entry.fromDisplay === undefined
      ? { name: "Unknown sender" }
      : parseSender(entry.fromDisplay)
  return (
    <MessageCard
      sender={sender.name}
      meta={sender.address}
      time={entry.at > 0 ? formatInstant(entry.at) : undefined}
    >
      {entry.body.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {source === "backfill"
            ? "The text of this message was not imported, only who sent it and when."
            : "This message arrived without readable text."}
        </p>
      ) : (
        <MessageBody>{entry.body}</MessageBody>
      )}
    </MessageCard>
  )
}
