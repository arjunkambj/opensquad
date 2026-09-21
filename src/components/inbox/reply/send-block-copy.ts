import type { SendBlockCode } from "../../../../convex/outreach/sendGates"

/**
 * Every reason the send boundary refuses, in the user's words.
 *
 * TOTAL over `SendBlockCode` on purpose: the backend's block codes are a
 * closed union, and a new one added there fails this file's type-check rather
 * than reaching a screen as a bare code. The preflight query types `code` as
 * a string, so `sendBlockCopy` still falls back — but the fallback exists for
 * an old client, not for a code we forgot.
 */
const SEND_BLOCK_COPY: Record<SendBlockCode, string> = {
  org_paused:
    "Sending is paused for this organization. Resume it in Settings and this can go out.",
  agent_not_sending:
    "Your agent is not in a sending mode. Switch it to Review or Autopilot on the Agent page.",
  conversation_not_open:
    "This conversation is closed. Reopen it to send on it.",
  human_takeover:
    "Automation is paused on this thread, so nothing is sent from it automatically.",
  draft_not_current:
    "A newer version of this email exists — this one is no longer the reply to send.",
  context_changed:
    "The thread moved after this reply was written, so it no longer answers what is here. It has to be rewritten.",
  no_current_approval: "This reply is waiting for your approval.",
  policy_changed:
    "Your sending settings changed after this reply was written, so it needs rewriting.",
  agent_revision_changed:
    "Your agent's instructions changed after this reply was written, so it needs rewriting.",
  inbox_unassigned:
    "No sending inbox is connected, so nothing can go out yet. Connect one in Settings.",
  inbox_mismatch:
    "This reply was written for a different inbox than the one connected now.",
  lead_rejected:
    "You rejected this lead, so nothing is sent to them. Approve the lead again if that changed.",
  lead_replied:
    "They replied after this was written, so it no longer fits the conversation. Write a new reply instead.",
  suppressed_email:
    "This address is on your blocklist, so it is never contacted.",
  suppressed_domain:
    "This address's domain is on your blocklist, so it is never contacted.",
  already_sent: "This reply has already gone out.",
  attempt_in_flight: "This reply is being sent right now.",
  attempt_uncertain:
    "The last send's outcome is unknown. Settle it before anything else goes out on this thread.",
  attempt_failed: "The last send failed.",
  unresolved_attempt:
    "Another send on this thread has not finished yet. Nothing else goes out until it does.",
  outside_window:
    "It is outside your sending hours. This goes out when the window opens again.",
  send_limit_reached:
    "Today's sending limit is used up. This goes out tomorrow.",
  booking_not_current:
    "The meeting this email offers has changed, so what it proposes is out of date.",
}

/** The copy for a code the preflight returned, whatever the client's age. */
export function sendBlockCopy(code: string | undefined): string {
  if (code === undefined) {
    return "This reply cannot go out yet."
  }
  return (
    SEND_BLOCK_COPY[code as SendBlockCode] ??
    `This reply cannot go out yet (${code}).`
  )
}
