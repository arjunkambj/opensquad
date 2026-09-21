/** Render mapped codes only; provider messages may contain operator-only details. */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { domainErrorCode } from "@/lib/convex-error"

export type InboxConnectionView = FunctionReturnType<
  typeof api.inbox.connection.getInboxConnection
>

export type InboxSyncView = InboxConnectionView["sync"]

type VerifyResult = FunctionReturnType<
  typeof api.inbox.connectActions.verifyAndStoreKey
>

export type VerifiedInbox = Extract<
  VerifyResult,
  { ok: true }
>["inboxes"][number]

export type InboxConnectErrorCode = Extract<VerifyResult, { ok: false }>["code"]

/** AgentMail is named because users supply its key. Other provider names and raw errors stay private. */
export const INBOX_CONNECT_ERROR_COPY: Record<InboxConnectErrorCode, string> = {
  key_rejected:
    "That key was refused. Check you pasted the whole key, then try again.",
  provider_unavailable:
    "AgentMail did not answer just now. Try again in a moment.",
  no_stored_key: "Paste your AgentMail key first.",
  secrets_unconfigured:
    "This deployment cannot store keys yet, so the inbox cannot be connected.",
  site_url_missing:
    "This deployment has no public address yet, so replies could not reach it.",
  inbox_not_found: "That inbox is no longer on this AgentMail account.",
  inbox_claimed_elsewhere:
    "That inbox is already the sending inbox of another organization. Pick a different one.",
  inbox_not_visible_to_key:
    "That key cannot see this organization's inbox. Use a key from the same AgentMail account, or disconnect first to move to a different mailbox.",
  webhook_registration_failed:
    "We could not set up inbound mail for that inbox. Try again.",
  not_connected: "Connect an inbox before replacing its key.",
}

/** Thrown domain codes also use mapped copy, never the operator-facing error message. */
export function requestErrorCopy(error: unknown, fallback: string): string {
  const code = domainErrorCode(error)
  switch (code) {
    case "RATE_LIMITED":
      return "Too many attempts in a row. Wait a moment and try again."
    // Any member of the active organization can manage its inbox; non-members receive NOT_FOUND.
    case "FORBIDDEN":
      return "You do not have access to this organization's sending inbox."
    case "UNAUTHENTICATED":
      return "Your session expired. Sign in again to change the sending inbox."
    case "INVALID":
      return "That value was not accepted. Check it and try again."
    default:
      return fallback
  }
}

export function connectionStatusLabel(view: InboxConnectionView): string {
  switch (view.connection) {
    case "connected":
      return view.status === "invalid" ? "Key invalid" : "Connected"
    case "invalid":
      return "Key invalid"
    case "none":
      return "Not connected"
  }
}

/** Terse value for the "Imported" row of the connected inbox. */
export function syncLabel(sync: InboxSyncView): string {
  switch (sync.state) {
    case "idle":
      return "Preparing…"
    case "importing":
      return sync.threads === 1
        ? "Syncing 1 thread…"
        : `Syncing ${sync.threads} threads…`
    case "imported":
      return sync.threads === 0
        ? "None in the last 30 days"
        : sync.threads === 1
          ? "1 thread, last 30 days"
          : `${sync.threads} threads, last 30 days`
    case "failed":
      return "Did not finish"
  }
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}
