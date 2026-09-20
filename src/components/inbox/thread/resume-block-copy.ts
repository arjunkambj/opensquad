import type { ResumeBlockCode } from "../../../../convex/inbox/conversationResume"

/**
 * Why restarting the agent on a thread was refused.
 *
 * TOTAL over `RESUME_BLOCK_CODES`, so a new refusal added to the backend
 * fails this file's type-check instead of reaching a screen as a bare code.
 */
export const RESUME_BLOCK_COPY: Record<ResumeBlockCode, string> = {
  association_missing:
    "No lead is linked to this thread yet — link one first.",
  agent_mismatch:
    "The linked lead now belongs to a different agent than this thread.",
  agent_not_sending:
    "Your agent is not in a sending mode, so replies cannot resume.",
  workspace_paused:
    "Sending is paused for this workspace — resume it in Settings first.",
  inbox_unassigned:
    "No sending inbox is connected, so nothing can be mailed from here.",
  inbox_mismatch:
    "This thread arrived on a different inbox than the one connected now.",
  recipient_unknown:
    "There is no address to reply to — the lead has no contact yet.",
  sender_unverified:
    "The reply's sender could not be read as a single address.",
  sender_contact_mismatch:
    "The reply came from a different address than the lead's.",
  suppressed_email:
    "That address is on your blocklist, so it is never contacted.",
  suppressed_domain:
    "That address's domain is on your blocklist, so it is never contacted.",
}

export function resumeBlockCopy(code: string): string {
  return (
    RESUME_BLOCK_COPY[code as ResumeBlockCode] ??
    `The agent could not be resumed on this thread (${code}).`
  )
}
