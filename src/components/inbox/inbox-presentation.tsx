import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import type {
  ConversationState,
  ReplyDisposition,
  TakeoverReason,
} from "../../../convex/lib/validators"
import { Chip } from "@/components/shared/presentation"

/**
 * Shared vocabulary for the inbox: every state is a word, never a colour
 * alone (V10). The strings are written for an operator who has not read the
 * schema — `unassigned` means "no lead is linked", not a lifecycle term.
 */

export const CONVERSATION_STATE_LABEL: Record<ConversationState, string> = {
  open: "Open",
  closed: "Closed",
  unassigned: "No lead linked",
}

export const CONVERSATION_TAB_LABEL: Record<ConversationState | "takeover", string> = {
  open: "Open",
  unassigned: "Unassigned",
  takeover: "Taken over",
  closed: "Closed",
}

/** What the reply pipeline last made of an inbound message. */
export const DISPOSITION_LABEL: Record<ReplyDisposition, string> = {
  interested: "Interested",
  question: "Question",
  not_now: "Not now",
  not_interested: "Not interested",
  unsubscribe: "Unsubscribe",
  automated: "Automated",
  needs_review: "Needs review",
}

/** Why automation is frozen on a thread — the distinction V16/V17 need. */
export const TAKEOVER_REASON_LABEL: Record<TakeoverReason, string> = {
  unassigned_inbound: "Held — this reply matched no thread",
  operator: "Held — an operator took over",
  ambiguous_opt_out: "Held — this reply may be an opt-out",
  awaiting_resume: "Held — waiting for an explicit resume",
  needs_review: "Held — classification could not be trusted",
}

export function ConversationStateChip({ state }: { state: ConversationState }) {
  return (
    <Chip
      className={
        state === "open"
          ? "bg-chart-2/15 text-chart-2"
          : state === "unassigned"
            ? "bg-chart-1/15 text-chart-1"
            : undefined
      }
    >
      {CONVERSATION_STATE_LABEL[state]}
    </Chip>
  )
}

export function DispositionChip({
  disposition,
}: {
  disposition: ReplyDisposition
}) {
  return <Chip>{DISPOSITION_LABEL[disposition]}</Chip>
}

/** One merged thread entry, as `conversations.thread` returns it. */
export type ThreadEntry = FunctionReturnType<
  typeof api.conversations.thread
>["items"][number]

/**
 * One outbound thread entry's state in words. The codes come from
 * `sendResultCode` in `convex/sending.ts` — `sent` means the provider
 * accepted the message, which is never rendered "Delivered" (§6, J3 ④).
 * A `draft` is a distinct variant, not an outbound message wearing a state.
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

/** Why a `resume` call refused to re-arm automation (RESUME_BLOCK_CODES). */
export const RESUME_BLOCK_LABEL: Record<string, string> = {
  association_missing:
    "No lead and agent are linked to this thread yet — link one first.",
  agent_mismatch:
    "The linked lead now belongs to a different agent than this thread.",
  agent_not_sending:
    "The agent is not in a mode that sends, so replies cannot resume.",
  workspace_paused:
    "Workspace automation is paused — resume it in Settings → Automation first.",
  inbox_unassigned:
    "This workspace has no sending inbox assigned yet, so nothing can be mailed.",
  inbox_mismatch:
    "This thread arrived on a different inbox than the workspace's current one.",
  recipient_unknown:
    "There is no address to mail — the lead has no contact and no draft resolved one.",
  sender_unverified:
    "The reply's sender could not be verified as a single address.",
  sender_contact_mismatch:
    "The reply's sender is not the address this workspace would mail.",
  suppressed_email:
    "This address is on the suppression list — automation stays frozen.",
  suppressed_domain:
    "This address's domain is on the suppression list — automation stays frozen.",
}

export function resumeBlockLabel(code: string): string {
  return (
    RESUME_BLOCK_LABEL[code] ??
    `Resume was refused (${code}). The thread stays under takeover.`
  )
}
