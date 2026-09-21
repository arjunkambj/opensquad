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
import {
  ConversationPaneSkeleton,
  MessagesSkeleton,
} from "@/components/inbox/InboxPageSkeleton"
import { ReplyCard } from "@/components/inbox/reply/ReplyCard"
import { ThreadHeader } from "@/components/inbox/thread/ThreadHeader"
import { ThreadTimeline } from "@/components/inbox/thread/ThreadTimeline"
import { PageSection } from "@/components/kit/PageSection"
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
    return <ConversationPaneSkeleton />
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
  const agentName = agent === null || agent.name === "" ? "Your agent" : agent.name
  const recipient = conversation.lastInboundFrom ?? prospect?.companyName
  const subject = thread?.items.find(
    (entry) => entry.subject !== undefined && entry.subject.length > 0,
  )?.subject

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="xl:hidden">
        <Button variant="ghost" render={<Link to="/inbox" search={true} />}>
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            data-icon="inline-start"
            aria-hidden="true"
          />
          All conversations
        </Button>
      </div>

      <ThreadHeader
        conversation={conversation}
        prospect={prospect}
        subject={subject}
        messageCount={
          thread?.items.filter((entry) => entry.kind === "inbound" || entry.state !== "draft")
            .length
        }
        actions={
          stale ? undefined : (
            <ConversationActions
              orgId={orgId}
              conversation={conversation}
              prospect={prospect}
              expectedContextVersion={seenVersion}
            />
          )
        }
      />

      {stale ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-foreground">
            This thread changed while you had it open. Load it before you act.
          </p>
          <Button
            variant="outline"
            onClick={() => setSeenVersion(conversation.contextVersion)}
          >
            Load the latest
          </Button>
        </div>
      ) : null}

      <PageSection>
        {thread === undefined ? (
          <MessagesSkeleton />
        ) : (
          <ThreadTimeline
            entries={thread.items}
            hasMore={thread.hasMore}
            source={conversation.source}
            currentDraftId={conversation.currentDraftId}
            agentName={agentName}
            recipient={recipient}
          />
        )}
        {stale ? null : (
          <ReplyCard
            orgId={orgId}
            conversation={conversation}
            agentName={agentName}
          />
        )}
      </PageSection>

      <ConversationNotes
        orgId={orgId}
        conversation={conversation}
      />
    </div>
  )
}
