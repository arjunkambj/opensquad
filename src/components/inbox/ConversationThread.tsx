import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  outboundStateLabel,
  type ThreadEntry,
} from "@/components/inbox/inbox-presentation"
import {
  Chip,
  formatInstant,
} from "@/components/shared/presentation"
import { EmptyState } from "@/components/states/states"

/**
 * The merged thread timeline (`conversations.thread`), newest first.
 *
 * §4.3 forbids a second messages table, so this composes component-held
 * inbound bodies with the immutable draft revisions and their send attempts.
 * Bodies render as plain text in `whitespace-pre-wrap` — the backend never
 * projects `html`, which removes raw-HTML injection and remote tracking-image
 * loads at the source rather than trusting a sanitizer (J4 ⑤).
 *
 * Newest-first is the order the query documents: two heterogeneous sources
 * cannot share one honest cursor, so `hasMore` here only ever means "the
 * merged page was truncated", never "older pages exist to fetch".
 */
export function ConversationThread({
  workspaceId,
  entries,
  hasMore,
  pendingDraftId,
}: {
  workspaceId: Id<"workspaces">
  entries: ThreadEntry[]
  hasMore: boolean
  /**
   * The conversation's `currentDraftId` when one is pending. A draft entry
   * matching it links out to its own `/decisions/$decisionId` — approve
   * buttons are never duplicated into the thread (J4 ④).
   */
  pendingDraftId: Id<"drafts"> | undefined
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No messages on this thread yet"
        description="Inbound replies and the squad's outbound drafts assemble here once the provider has delivered either."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {entries.map((entry, index) =>
          entry.kind === "inbound" ? (
            <InboundMessage
              key={`in-${entry.messageRef}-${index}`}
              entry={entry}
            />
          ) : (
            <OutboundMessage
              key={`out-${entry.draftId}`}
              workspaceId={workspaceId}
              entry={entry}
              pending={entry.draftId === pendingDraftId}
            />
          ),
        )}
      </ol>
      {hasMore ? (
        <p className="text-xs text-muted-foreground">
          This thread is longer than one page — the merged view shows the most
          recent entries.
        </p>
      ) : null}
    </div>
  )
}

function InboundMessage({
  entry,
}: {
  entry: Extract<ThreadEntry, { kind: "inbound" }>
}) {
  return (
    <li className="flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] border border-border bg-card px-4 py-3">
      <header className="flex flex-wrap items-center gap-2">
        <Chip>Reply received</Chip>
        {entry.fromDisplay !== undefined ? (
          <span className="text-xs font-medium text-foreground">
            {entry.fromDisplay}
          </span>
        ) : null}
        {entry.at > 0 ? (
          <span className="text-xs text-muted-foreground">
            {formatInstant(entry.at)}
          </span>
        ) : null}
      </header>
      {entry.subject !== undefined ? (
        <p className="text-sm font-medium text-foreground">{entry.subject}</p>
      ) : null}
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
        {entry.body}
      </p>
    </li>
  )
}

function OutboundMessage({
  workspaceId,
  entry,
  pending,
}: {
  workspaceId: Id<"workspaces">
  entry: Extract<ThreadEntry, { kind: "outbound" }>
  pending: boolean
}) {
  const isDraft = entry.state === "draft"
  return (
    <li
      className={
        isDraft
          ? "flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-4 py-3"
          : "flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-muted/60 px-4 py-3"
      }
    >
      <header className="flex flex-wrap items-center gap-2">
        {/* A pending draft never sits in the position or style of a sent
            message — dashed border, its own word, and a link to the shared
            decision instead of any send-looking badge. */}
        <Chip className={isDraft ? undefined : "bg-chart-2/15 text-chart-2"}>
          {isDraft ? "Draft — awaiting approval" : "Sent by the squad"}
        </Chip>
        <span className="text-xs text-muted-foreground">
          revision {entry.revision} · {outboundStateLabel(entry.state)}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatInstant(entry.at)}
        </span>
      </header>
      <p className="text-sm font-medium text-foreground">{entry.subject}</p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
        {entry.body}
      </p>
      {entry.deliveredAt !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Provider reported delivery {formatInstant(entry.deliveredAt)} — a
          verified receipt fact, separate from acceptance.
        </p>
      ) : null}
      {entry.bouncedAt !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Provider reported a bounce {formatInstant(entry.bouncedAt)}.
        </p>
      ) : null}
      {pending ? (
        <div>
          <PendingDraftLink workspaceId={workspaceId} draftId={entry.draftId} />
        </div>
      ) : null}
    </li>
  )
}

/**
 * A pending draft, identified by its current revision. There is no approval
 * surface to link to while the outbound agent is being rebuilt, so this states
 * what exists rather than offering a route that would 404.
 */
function PendingDraftLink({
  workspaceId,
  draftId,
}: {
  workspaceId: Id<"workspaces">
  draftId: Id<"drafts">
}) {
  const draft = useQuery(api.drafts.get, { workspaceId, draftId })

  if (draft === undefined) {
    return (
      <span className="text-xs text-muted-foreground">
        Reading this draft…
      </span>
    )
  }
  return (
    <span className="text-xs text-muted-foreground">
      Revision {draft.revision} is written and waits for a recorded approval.
    </span>
  )
}
