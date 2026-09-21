/** Reverse the newest-first bounded page for chronological reading.
 * Render bodies as plain text to exclude HTML injection and tracking pixels. */
import { MailOpen01Icon } from "@hugeicons/core-free-icons"
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
  agentName,
  recipient,
}: {
  entries: ThreadEntry[]
  hasMore: boolean
  source: MessageSource
  /** The draft the reply card owns. It is shown there, with its actions, and
   *  left out here so it never appears twice. */
  currentDraftId: Id<"drafts"> | undefined
  agentName: string
  recipient: string | undefined
}) {
  const oldestFirst = [...entries]
    .reverse()
    .filter(
      (entry) =>
        !(
          entry.kind === "outbound" &&
          entry.state === "draft" &&
          entry.draftId === currentDraftId
        ),
    )

  if (oldestFirst.length === 0) {
    return (
      <EmptyState
        icon={MailOpen01Icon}
        title="No messages yet"
        description={
          source === "backfill"
            ? "Imported without its text. New mail will appear in full."
            : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {hasMore ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the most recent messages on this thread.
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
              sender={agentName}
              recipient={recipient}
            />
          ),
        )}
      </ol>
    </div>
  )
}
