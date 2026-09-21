import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import type {
  LeadStage,
  MessageSource,
  ReplyDisposition,
} from "../../../convex/lib/validators"
import { Chip } from "@/components/kit/Chip"

export const INBOX_PILLS = ["received", "interested", "unread", "all"] as const

export type InboxPill = (typeof INBOX_PILLS)[number]

export const PILL_LABEL: Record<InboxPill, string> = {
  received: "Received",
  interested: "Interested",
  unread: "Unread",
  all: "All",
}

const DISPOSITION_LABEL: Record<ReplyDisposition, string> = {
  interested: "Interested",
  question: "Question",
  not_now: "Not now",
  not_interested: "Not interested",
  unsubscribe: "Unsubscribe",
  automated: "Automated",
  needs_review: "Needs review",
}

const STAGE_LABEL: Record<LeadStage, string> = {
  found: "Found",
  researched: "Researched",
  queued: "Queued",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting_proposed: "Meeting proposed",
  meeting_booked: "Meeting booked",
  closed_lost: "Closed lost",
  rejected: "Rejected",
  needs_attention: "Needs attention",
}

export function DispositionChip({
  disposition,
}: {
  disposition: ReplyDisposition
}) {
  return (
    <Chip
      className={
        disposition === "interested"
          ? "bg-chart-2/15 text-chart-2"
          : disposition === "unsubscribe" || disposition === "not_interested"
            ? "bg-destructive/10 text-destructive"
            : undefined
      }
    >
      {DISPOSITION_LABEL[disposition]}
    </Chip>
  )
}

export function StageChip({ stage }: { stage: LeadStage }) {
  return (
    <Chip
      className={
        stage === "meeting_booked" || stage === "interested"
          ? "bg-chart-2/15 text-chart-2"
          : undefined
      }
    >
      {STAGE_LABEL[stage]}
    </Chip>
  )
}

/**
 * The "Mark interested" control's words, kept beside the rest of the inbox
 * vocabulary rather than inline in the button.
 *
 * It says what the click does and, just as importantly, what it does not:
 * marking a reply interested tags the thread and moves the lead in Contacts.
 * A meeting is still only a meeting when a person records one (PLAN §9.5).
 */
export const MARK_INTERESTED_COPY = {
  label: "Mark interested",
  pending: "Marking…",
  success: "Marked interested — the lead moved to Interested",
  already: "Marked interested. Use Mark as booked when a time is agreed.",
  failure: "Could not mark this conversation interested.",
} as const

export function NeedsApprovalChip() {
  return <Chip className="bg-primary/10 text-primary">Needs your approval</Chip>
}

/**
 * Why a thread may be missing its message text. Connecting an inbox imports
 * the last 30 days of threads — who wrote, on which thread and when — but the
 * provider's bodies are not copied into our store, so a backfilled message
 * has a header and no text. Saying that is the only honest option; inventing
 * the body is not.
 */
export function sourceNote(source: MessageSource): string | undefined {
  return source === "backfill"
    ? "Imported when this inbox was connected. Imported messages carry their sender and time, not their text."
    : undefined
}

export type ThreadEntry = FunctionReturnType<
  typeof api.inbox.conversationThread.thread
>["items"][number]

export type InboxRowData = FunctionReturnType<
  typeof api.inbox.inboxList.list
>["items"][number]

/**
 * An outbound entry's state in words. The codes come from `sendResultCode`
 * in `convex/outreach/sendGates.ts`: `sent` means the provider accepted the
 * message, which is never rendered as "Delivered".
 */
export function outboundStateLabel(
  state: Extract<ThreadEntry, { kind: "outbound" }>["state"],
): string {
  switch (state) {
    case "draft":
      return "Draft — not sent"
    case "pending":
      return "Sending — handed to the provider, no result yet"
    case "sent":
      return "Sent — the provider accepted it"
    case "definitely_unsent":
      return "Not sent — it never reached the provider"
    case "rejected":
      return "Rejected — the provider refused it"
    case "delivery_uncertain":
      return "Delivery uncertain — the outcome is unknown"
  }
}

export function leadDisplayName(lead: {
  firstName?: string
  lastName?: string
  companyName?: string
}): string {
  const name = [lead.firstName, lead.lastName]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" ")
  if (name.length > 0) {
    return name
  }
  return lead.companyName ?? "Unnamed lead"
}
