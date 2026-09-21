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
import { useEffect, useRef, useState } from "react"
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
import { useCurrentOrg } from "@/hooks/use-current-org"
import { useEscapeToParent } from "@/hooks/use-queue-navigation"

const MARK_READ_MAX_RETRIES = 3

const MARK_READ_RETRY_MS = 2_000

export function ConversationPane({
  conversationId,
}: {
  conversationId: Id<"conversations">
}) {
  const current = useCurrentOrg()
  // Escape returns to the list, so the URL and the view never disagree.
  useEscapeToParent("/inbox")
  const orgId = current.status === "ready" ? current.org._id : undefined

  const detail = useQuery(
    api.inbox.conversations.get,
    orgId === undefined ? "skip" : { orgId, conversationId },
  )
  const thread = useQuery(
    api.inbox.conversationThread.thread,
    orgId === undefined ? "skip" : { orgId, conversationId },
  )
  const markRead = useMutation(api.inbox.conversationLifecycle.markRead)

  // Mark as cleared only after the write succeeds; track in-flight attempts and retry failures with a bound.
  // Clearing unread does not bump contextVersion or invalidate drafts.
  const unread = detail?.conversation.unreadCount ?? 0
  const cleared = useRef<{ conversationId: string; count: number } | null>(null)
  const clearing = useRef(false)
  const failures = useRef(0)
  const [clearAttempt, setClearAttempt] = useState(0)
  useEffect(() => {
    // A different thread is a different clear: forget both the success and
    // the failures of the last one.
    cleared.current = null
    failures.current = 0
  }, [conversationId])
  useEffect(() => {
    if (orgId === undefined) {
      return
    }
    if (unread === 0) {
      // Cleared — including by our own write. Forgetting what we cleared is
      // what lets the NEXT reply on this open thread clear too.
      cleared.current = null
      failures.current = 0
      return
    }
    const last = cleared.current
    if (last !== null && last.conversationId === conversationId && last.count >= unread) {
      return
    }
    if (clearing.current) {
      return
    }
    clearing.current = true
    let retry: ReturnType<typeof setTimeout> | undefined
    void markRead({ orgId, conversationId })
      .then(() => {
        cleared.current = { conversationId, count: unread }
        failures.current = 0
      })
      .catch(() => {
        // Leave the count uncleared on failure. Retry with bounded backoff, then leave the badge for the next interaction.
        failures.current += 1
        if (failures.current <= MARK_READ_MAX_RETRIES) {
          retry = setTimeout(() => {
            setClearAttempt((attempt) => attempt + 1)
          }, MARK_READ_RETRY_MS * failures.current)
        }
      })
      .finally(() => {
        clearing.current = false
      })
    return () => {
      if (retry !== undefined) {
        clearTimeout(retry)
      }
    }
  }, [orgId, conversationId, unread, markRead, clearAttempt])

  if (orgId === undefined || detail === undefined) {
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
      orgId={orgId}
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
  orgId,
  detail,
  thread,
}: {
  orgId: Id<"orgs">
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
          orgId={orgId}
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
            orgId={orgId}
            conversation={conversation}
          />
          <ConversationActions
            orgId={orgId}
            conversation={conversation}
            prospect={prospect}
            expectedContextVersion={seenVersion}
          />
        </>
      )}

      <ConversationNotes
        orgId={orgId}
        conversation={conversation}
      />
    </div>
  )
}
