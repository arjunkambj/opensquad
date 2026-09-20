import { CatchBoundary, Link } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  Chip,
  formatWaited,
} from "@/components/shared/presentation"
import {
  ConversationStateChip,
  DispositionChip,
} from "@/components/inbox/inbox-presentation"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/states/states"
import { Button } from "@/components/ui/button"

type ConversationSummary = FunctionReturnType<
  typeof api.conversations.listForProspect
>["items"][number]

/**
 * The lead's threads — `conversations.listForProspect`, newest first. The
 * read sits inside its own boundary: the query is one of this lane's bounded
 * additions, and on a deployment that predates it the tab must degrade to an
 * honest "unavailable" rather than a broken page.
 */
export function LeadConversations({
  workspaceId,
  prospectId,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
}) {
  return (
    <section
      aria-label="Conversations"
      className="flex flex-col gap-3 rounded-xl bg-card p-5"
    >
      <h3 className="text-sm font-medium">
        Threads on this lead — the inbox holds the messages
      </h3>
      <CatchBoundary
        getResetKey={() => prospectId}
        errorComponent={LeadConversationsError}
      >
        <ConversationsPage
          workspaceId={workspaceId}
          prospectId={prospectId}
          cursor={undefined}
        />
      </CatchBoundary>
    </section>
  )
}

function ConversationsPage({
  workspaceId,
  prospectId,
  cursor,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  cursor: string | undefined
}) {
  const page = useQuery(api.conversations.listForProspect, {
    workspaceId,
    prospectId,
    ...(cursor === undefined ? {} : { cursor }),
  })
  const [showMore, setShowMore] = useState(false)

  if (page === undefined) {
    return (
      <LoadingState
        title="Loading threads"
        description="Reading the conversations bound to this lead."
      />
    )
  }

  return (
    <>
      {page.items.length === 0 && cursor === undefined ? (
        <EmptyState
          title="No conversation yet"
          description="A thread appears here when the first approved email goes out on this lead — or when a reply arrives. Nothing has been mailed on it yet."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {page.items.map((item) => (
            <ConversationRow key={item.conversationId} item={item} />
          ))}
        </ul>
      )}
      {page.hasMore && page.cursor !== null ? (
        showMore ? (
          <ConversationsPage
            workspaceId={workspaceId}
            prospectId={prospectId}
            cursor={page.cursor}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setShowMore(true)}
          >
            Show more threads
          </Button>
        )
      ) : null}
    </>
  )
}

/** One thread row — a link into the inbox thread view, which owns the
 *  messages, the draft and the send facts. */
function ConversationRow({ item }: { item: ConversationSummary }) {
  return (
    <li>
      <Link
        to="/inbox/$conversationId"
        params={{ conversationId: item.conversationId }}
        className="flex flex-col gap-1.5 rounded-lg bg-muted/40 px-4 py-3 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <div className="flex flex-wrap items-center gap-2">
          <ConversationStateChip state={item.state} />
          {item.humanTakeover ? <Chip>Automation frozen</Chip> : null}
          {item.lastDisposition !== undefined ? (
            <DispositionChip disposition={item.lastDisposition} />
          ) : null}
          {item.hasDraft ? (
            <Chip className="bg-chart-2/15 text-chart-2">Draft ready</Chip>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {item.lastMessageAt !== undefined
              ? `last message ${formatWaited(item.lastMessageAt)}`
              : "no messages yet"}
          </span>
        </div>
        <p className="text-sm text-foreground">
          {item.lastInboundFrom !== undefined
            ? `last from ${item.lastInboundFrom}`
            : "Outbound thread — opened by an approved send"}
          {item.unreadCount > 0
            ? ` · ${item.unreadCount} unread`
            : ""}
        </p>
      </Link>
    </li>
  )
}

/**
 * The bounded read is new in this lane — a deployment that predates it has
 * no `listForProspect` and the query throws here, scoped to this panel.
 */
function LeadConversationsError({ error, reset }: ErrorComponentProps) {
  const missing = error instanceof Error && /function|Could not find/i.test(error.message)
  return (
    <ErrorState
      title={missing ? "Threads are not available yet" : "Threads didn't load"}
      description={
        missing
          ? "The deployment behind this build does not yet serve the per-lead thread read — it lands with this change's push. The inbox itself is unchanged at /inbox."
          : "The thread list could not be loaded. Nothing here was changed."
      }
      onRetry={reset}
      retryLabel="Try again"
    />
  )
}
