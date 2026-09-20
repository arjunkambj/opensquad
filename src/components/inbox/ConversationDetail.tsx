import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { ConversationActions } from "@/components/inbox/ConversationActions"
import { ConversationNotes } from "@/components/inbox/ConversationNotes"
import { ConversationThread } from "@/components/inbox/ConversationThread"
import {
  ConversationStateChip,
  DISPOSITION_LABEL,
} from "@/components/inbox/inbox-presentation"
import {
  Chip,
  DetailRow,
  formatInstant,
} from "@/components/shared/presentation"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useEscapeToParent } from "@/hooks/use-queue-navigation"

/**
 * One thread (`/inbox/$conversationId`).
 *
 * Every mutation here takes `expectedContextVersion`, and the version sent is
 * the one the operator SAW, not the live one — pinned when the detail mounts,
 * exactly as `DecisionDetail` pins `reviewedVersion`. When the thread moves
 * underneath (a reply landed, a colleague resumed it), the page flips to an
 * explicit stale state naming the current version with one action to load it,
 * rather than failing at the server or acting on unread state (J6 ⑧).
 */
export function ConversationDetail({
  conversationId,
}: {
  conversationId: Id<"conversations">
}) {
  const current = useCurrentWorkspace()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEscapeToParent("/inbox")

  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined

  const detail = useQuery(
    api.conversations.get,
    workspaceId === undefined ? "skip" : { workspaceId, conversationId },
  )
  const thread = useQuery(
    api.conversations.thread,
    workspaceId === undefined ? "skip" : { workspaceId, conversationId },
  )
  const employees = useQuery(
    api.employees.list,
    workspaceId === undefined ? "skip" : { workspaceId },
  )
  const markRead = useMutation(api.conversations.markRead)

  // Focus lands on the heading when a thread opens — once per thread, not on
  // every live update, or a refresh would steal focus from whatever the
  // operator is doing. The row that opened it gets focus back on the way out
  // (the list tracks its id, not a DOM ref).
  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    if (detail !== undefined && focusedFor.current !== conversationId) {
      focusedFor.current = conversationId
      headingRef.current?.focus()
    }
  }, [detail, conversationId])

  // Reading a thread clears its unread counter — a member-level write that
  // deliberately does not touch `contextVersion` (a read is not a change
  // anyone's draft was written against).
  const unread = detail?.conversation.unreadCount ?? 0
  useEffect(() => {
    if (workspaceId !== undefined && unread > 0) {
      void markRead({ workspaceId, conversationId }).catch(() => {
        // A failed markRead must not break the page — the count is a badge,
        // not a lock.
      })
    }
  }, [workspaceId, conversationId, unread, markRead])

  if (current === undefined || current === null || detail === undefined) {
    return (
      <LoadingState
        title="Loading the thread"
        description="Reading the conversation and its history."
      />
    )
  }

  return (
    <LoadedConversation
      workspaceId={current.workspace._id}
      role={current.role}
      detail={detail}
      thread={thread}
      employeeName={(employeeId) =>
        employees?.find((employee) => employee._id === employeeId)?.name
      }
      headingRef={headingRef}
    />
  )
}

function LoadedConversation({
  workspaceId,
  role,
  detail,
  thread,
  employeeName,
  headingRef,
}: {
  workspaceId: Id<"workspaces">
  role: "owner" | "operator" | "viewer"
  detail: FunctionReturnType<typeof api.conversations.get>
  thread: FunctionReturnType<typeof api.conversations.thread> | undefined
  employeeName: (employeeId: Id<"employees">) => string | undefined
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  const { conversation, prospect, campaign } = detail

  // The version pinned at mount. `setSeenVersion` is the "load current" act.
  const [seenVersion, setSeenVersion] = useState(conversation.contextVersion)
  const stale = conversation.contextVersion !== seenVersion

  // Whether the verified inbound sender sits on the suppression list — the
  // fact `resume` would refuse on. Checked against `lastInboundFrom`, which is
  // the only address this page can verify honestly.
  const suppression = useQuery(
    api.suppressions.check,
    conversation.lastInboundFrom === undefined
      ? "skip"
      : { workspaceId, email: conversation.lastInboundFrom },
  )

  const employee = employeeName(conversation.employeeId)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/inbox" search={true} />}
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            strokeWidth={2}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Back to inbox
        </Button>
      </div>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ConversationStateChip state={conversation.state} />
          {conversation.humanTakeover ? <Chip>Automation frozen</Chip> : null}
          {conversation.lastDisposition !== undefined ? (
            <Chip>
              {DISPOSITION_LABEL[conversation.lastDisposition]}
            </Chip>
          ) : null}
          {conversation.unreadCount > 0 ? (
            <span className="text-xs font-medium text-foreground">
              {conversation.unreadCount} unread
            </span>
          ) : null}
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-semibold text-foreground outline-none"
        >
          {prospect?.companyName ??
            (conversation.state === "unassigned"
              ? "Unmatched reply"
              : "Conversation")}
        </h1>
        <dl className="flex flex-col gap-1.5">
          {prospect !== null ? (
            <DetailRow
              label="Lead"
              value={`${prospect.companyName} — ${prospect.salesStage}`}
            />
          ) : null}
          {campaign !== null ? (
            <DetailRow
              label="Campaign"
              value={`${campaign.title} (${campaign.status})`}
            />
          ) : null}
          {conversation.lastInboundFrom !== undefined ? (
            <DetailRow
              label="Latest reply from"
              value={conversation.lastInboundFrom}
            />
          ) : null}
          <DetailRow
            label="Worked by"
            value={employee ?? "an employee"}
          />
          {conversation.assigneeIdentityKey !== undefined ? (
            <DetailRow
              label="Human owner"
              value={conversation.assigneeIdentityKey.split("|").pop()}
            />
          ) : null}
        </dl>

        {conversation.lastDisposition !== undefined ? (
          <p className="max-w-3xl text-sm text-muted-foreground">
            The reply pipeline labelled the latest inbound{" "}
            <span className="text-foreground">
              {DISPOSITION_LABEL[conversation.lastDisposition]}
            </span>
            {conversation.lastDispositionAt !== undefined
              ? ` at ${formatInstant(conversation.lastDispositionAt)}`
              : ""}
            . A label is a read, not a decision — taking the thread over is
            always a human act away.
          </p>
        ) : null}

        {suppression?.suppressed === true ? (
          <p className="max-w-3xl rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-foreground">
            {conversation.lastInboundFrom} is on the suppression list
            {suppression.matchedBy === "domain" ? " (matched by domain)" : ""}.
            Resuming automation will refuse — the suppression has to be lifted
            in Settings → Sending first.
          </p>
        ) : null}
      </header>

      {stale ? (
        <div className="flex max-w-3xl flex-col items-start gap-2 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-4 py-3">
          <p className="text-sm text-foreground">
            This thread changed while you had it open — it is now at version{" "}
            {conversation.contextVersion}, not {seenVersion}. Load it before
            acting, so you act on what is actually here.
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
        <LoadingState
          title="Loading messages"
          description="Reading this thread's history."
        />
      ) : (
        <ConversationThread
          workspaceId={workspaceId}
          entries={thread.items}
          hasMore={thread.hasMore}
          pendingDraftId={conversation.currentDraftId}
        />
      )}

      {stale ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          Thread controls are paused until you load the current version above —
          your typed notes are kept.
        </p>
      ) : (
        <ConversationActions
          workspaceId={workspaceId}
          role={role}
          conversation={conversation}
          expectedContextVersion={seenVersion}
        />
      )}

      <ConversationNotes
        workspaceId={workspaceId}
        role={role}
        conversation={conversation}
      />
    </div>
  )
}
