import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import type {
  LeadStage,
  MessageSource,
  ReplyDisposition,
} from "../../../convex/lib/validators"
import { Chip, type ChipVariant } from "@/components/kit/Chip"
import { cn } from "@/lib/utils"

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

export const DISPOSITION_VARIANT: Record<ReplyDisposition, ChipVariant> = {
  interested: "accent",
  question: "accent",
  not_now: "muted",
  not_interested: "destructive",
  unsubscribe: "destructive",
  automated: "muted",
  needs_review: "accent",
}

/** Shared with Leads, so a stage reads the same colour on every screen. */
export function stageChipVariant(stage: LeadStage): ChipVariant {
  switch (stage) {
    case "interested":
    case "meeting_proposed":
      return "accent"
    case "meeting_booked":
      return "success"
    case "needs_attention":
      return "destructive"
    default:
      return "muted"
  }
}

export function DispositionChip({
  disposition,
}: {
  disposition: ReplyDisposition
}) {
  return (
    <Chip variant={DISPOSITION_VARIANT[disposition]}>
      {DISPOSITION_LABEL[disposition]}
    </Chip>
  )
}

export function StageChip({ stage }: { stage: LeadStage }) {
  return (
    <Chip variant={stageChipVariant(stage)}>
      {STAGE_LABEL[stage]}
    </Chip>
  )
}

/**
 * The "Mark interested" control's words, kept beside the rest of the inbox
 * vocabulary rather than inline in the button.
 *
 * It says what the click does and, just as importantly, what it does not:
 * marking a reply interested tags the thread and moves the lead in Leads.
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
  return <Chip variant="accent">Draft ready</Chip>
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

/** "Jane Doe <jane@acme.com>" → { name: "Jane Doe", address: "jane@acme.com" }. */
export function parseSender(from: string): { name: string; address?: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from)
  if (match === null) {
    return { name: from.trim() }
  }
  const name = match[1]?.trim() ?? ""
  const address = match[2]?.trim()
  return { name: name.length > 0 ? name : (address ?? from), address }
}

export function initialsOf(name: string): string {
  const words = name
    .replace(/<[^>]*>|@.*$/g, "")
    .split(/[\s._-]+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
  const letters =
    words.length >= 2
      ? `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`
      : (words[0]?.slice(0, 2) ?? "")
  return letters.length > 0 ? letters.toUpperCase() : "?"
}

const AVATAR_TONES = [
  "bg-chart-1/15 text-chart-1",
  "bg-chart-2/15 text-chart-2",
  "bg-chart-3/15 text-chart-3",
  "bg-chart-4/15 text-chart-4",
  "bg-chart-5/15 text-chart-5",
] as const

/** A stable tone per person, so the same sender keeps one colour everywhere. */
export function avatarTone(seed: string): string {
  let hash = 0
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length] ?? AVATAR_TONES[0]
}

export function PersonAvatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        avatarTone(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
