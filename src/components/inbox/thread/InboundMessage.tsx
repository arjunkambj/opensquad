/**
 * One reply the lead sent.
 *
 * A message whose body we do not hold says so. Connecting an inbox imports
 * the recent threads' identities, senders and timestamps but not their text,
 * so an imported message has a header and nothing under it — and an empty
 * body is never filled in with a summary or a guess.
 */
import type { MessageSource } from "../../../../convex/lib/validators"
import type { ThreadEntry } from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
import { formatInstant } from "@/lib/presentation"

export function InboundMessage({
  entry,
  source,
}: {
  entry: Extract<ThreadEntry, { kind: "inbound" }>
  source: MessageSource
}) {
  return (
    <li className="flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] border border-border bg-card px-4 py-3">
      <header className="flex flex-wrap items-center gap-2">
        <Chip>Reply</Chip>
        {entry.fromDisplay === undefined ? null : (
          <span className="min-w-0 truncate text-xs font-medium text-foreground">
            {entry.fromDisplay}
          </span>
        )}
        {entry.at > 0 ? (
          <span className="text-xs text-muted-foreground">
            {formatInstant(entry.at)}
          </span>
        ) : null}
      </header>
      {entry.subject === undefined ? null : (
        <p className="text-sm font-medium text-foreground">{entry.subject}</p>
      )}
      {entry.body.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {source === "backfill"
            ? "The text of this message was not imported — only who sent it and when."
            : "This message arrived without readable text."}
        </p>
      ) : (
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
          {entry.body}
        </p>
      )}
    </li>
  )
}
