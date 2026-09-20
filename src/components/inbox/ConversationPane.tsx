/**
 * One thread (`/inbox/$conversationId`) — the reading pane of reference 24.
 *
 * The container owns every Convex read the pane needs and pins the context
 * version the reader actually SAW. Every mutation underneath sends that
 * pinned version, so a reply landing while the thread is open flips the pane
 * to an explicit "this moved" state instead of acting on something the reader
 * never saw.
 */
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useEffect, useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ConversationActions } from "@/components/inbox/ConversationActions"
import { ConversationNotes } from "@/components/inbox/ConversationNotes"
import { ReplyCard } from "@/components/inbox/reply/ReplyCard"
import { AssociateLeadCard } from "@/components/inbox/thread/AssociateLeadCard"
import { LeadSummary } from "@/components/inbox/thread/LeadSummary"
import { ThreadHeader } from "@/components/inbox/thread/ThreadHeader"
import { ThreadTimeline } from "@/components/inbox/thread/ThreadTimeline"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useEscapeToParent } from "@/hooks/use-queue-navigation"

export function ConversationPane({
  conversationId,
}: {
  conversationId: Id<"conversations">
}) {
  const current = useCurrentWorkspace()
  // Escape returns to the list, so the URL and the view never disagree.
  useEscapeToParent("/inbox")
  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined

  const detail = useQuery(
    api.inbox.conversations.get,
    workspaceId === undefined ? "skip" : { workspaceId, conversationId },
  )
  const thread = useQuery(
    api.inbox.conversationThread.thread,
    workspaceId === undefined ? "skip" : { workspaceId, conversationId },
  )
  const markRead = useMutation(api.inbox.conversationLifecycle.markRead)

  // Opening a thread clears its unread counter. A read is not a change any
  // draft was written against, so this deliberately does not move
  // `contextVersion`, and a failure here must not break the pane.
  const unread = detail?.conversation.unreadCount ?? 0
  useEffect(() => {
    if (workspaceId !== undefined && unread > 0) {
      void markRead({ workspaceId, conversationId }).catch(() => undefined)
    }
  }, [workspaceId, conversationId, unread, markRead])

  if (current === undefined || current === null || detail === undefined) {
    return (
      <LoadingState
        title="Loading the conversation"
        description="Reading the thread and everything waiting on it."
      />
    )
  }

  return (
    <LoadedConversation
      key={conversationId}
      workspaceId={current.workspace._id}
      role={current.role}
      detail={detail}
      thread={thread}
    />
  )
}

type Detail = FunctionReturnType<typeof api.inbox.conversations.get>
type Thread =
  | FunctionReturnType<typeof api.inbox.conversationThread.thread>
  | undefined

function LoadedConversation({
  workspaceId,
  role,
  detail,
  thread,
}: {
  workspaceId: Id<"workspaces">
  role: "owner" | "operator" | "viewer"
  detail: Detail
  thread: Thread
}) {
  const { conversation, prospect, agent } = detail
  // The version pinned when the pane mounted; "load the current version" is
  // the explicit act of accepting what changed.
  const [seenVersion, setSeenVersion] = useState(conversation.contextVersion)
  const stale = conversation.contextVersion !== seenVersion

  return (
    <div className="flex flex-col gap-5">
      <div className="xl:hidden">
        <Button variant="ghost" size="sm" render={<Link to="/inbox" search={true} />}>
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            data-icon="inline-start"
            aria-hidden="true"
          />
          All conversations
        </Button>
      </div>

      <ThreadHeader conversation={conversation} prospect={prospect} agent={agent} />

      {prospect === null ? (
        <AssociateLeadCard
          workspaceId={workspaceId}
          role={role}
          conversation={conversation}
          expectedContextVersion={seenVersion}
        />
      ) : (
        <LeadSummary prospect={prospect} conversation={conversation} />
      )}

      {stale ? (
        <div className="flex max-w-3xl flex-col items-start gap-2 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-4 py-3">
          <p className="text-sm text-foreground">
            This thread changed while you had it open — something arrived or
            someone acted on it. Load it before you approve or send, so you act
            on what is actually here.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSeenVersion(conversation.contextVersion)}
          >
            Load the current version
          </Button>
        </div>
      ) : null}

      {thread === undefined ? (
        <LoadingState title="Loading messages" />
      ) : (
        <ThreadTimeline
          entries={thread.items}
          hasMore={thread.hasMore}
          source={conversation.source}
          currentDraftId={conversation.currentDraftId}
        />
      )}

      {stale ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          The reply and the thread controls are paused until you load the
          current version above. Anything you have typed is kept.
        </p>
      ) : (
        <>
          <ReplyCard
            workspaceId={workspaceId}
            role={role}
            conversation={conversation}
          />
          <ConversationActions
            workspaceId={workspaceId}
            role={role}
            conversation={conversation}
            prospect={prospect}
            expectedContextVersion={seenVersion}
          />
        </>
      )}

      <ConversationNotes
        workspaceId={workspaceId}
        role={role}
        conversation={conversation}
      />
    </div>
  )
}
