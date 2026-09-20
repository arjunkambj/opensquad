/**
 * The merged thread: inbound replies and the mail we sent, oldest first.
 *
 * The query returns the most recent entries newest-first and cannot page two
 * heterogeneous sources under one cursor, so this reverses that page for
 * reading and says plainly when older entries are not on it.
 *
 * Bodies render as plain text — the backend never projects `html`, which
 * removes raw-HTML injection and remote tracking pixels at the source rather
 * than trusting a sanitizer here.
 */
import type { Id } from "../../../../convex/_generated/dataModel"
import type { MessageSource } from "../../../../convex/lib/validators"
import type { ThreadEntry } from "@/components/inbox/inbox-presentation"
import { InboundMessage } from "@/components/inbox/thread/InboundMessage"
import { OutboundMessage } from "@/components/inbox/thread/OutboundMessage"
import { EmptyState } from "@/components/states/states"

export function ThreadTimeline({
  entries,
  hasMore,
  source,
  currentDraftId,
}: {
  entries: ThreadEntry[]
  hasMore: boolean
  source: MessageSource
  /** The draft the reply card owns; the thread annotates it, never duplicates
   *  its buttons. */
  currentDraftId: Id<"drafts"> | undefined
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No messages on this thread yet"
        description={
          source === "backfill"
            ? "This thread was imported when the inbox was connected. Its messages' text was not copied across, so there is nothing to read here — new mail on it will appear in full."
            : "The emails sent on this thread and the replies to them appear here."
        }
      />
    )
  }

  const oldestFirst = [...entries].reverse()

  return (
    <div className="flex flex-col gap-3">
      {hasMore ? (
        <p className="text-xs text-muted-foreground">
          This thread is longer than one page — these are its most recent
          messages.
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {oldestFirst.map((entry, index) =>
          entry.kind === "inbound" ? (
            <InboundMessage
              key={`in-${entry.messageRef}-${index}`}
              entry={entry}
              source={source}
            />
          ) : (
            <OutboundMessage
              key={`out-${entry.draftId}`}
              entry={entry}
              pending={entry.draftId === currentDraftId}
            />
          ),
        )}
      </ol>
    </div>
  )
}
