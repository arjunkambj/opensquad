/**
 * The vocabulary of the Manage-inbox screen: the shapes the backend returns,
 * and OUR copy for every way the connect flow can refuse.
 *
 * WHY THE COPY LIVES HERE. `verifyAndStoreKey` and friends answer with a
 * closed set of codes plus an operator-facing `message` that may quote the
 * mail provider. The message is never rendered; the code is mapped below, in
 * one `Record` over the union taken from the generated types — so a new
 * backend code fails this build until someone writes copy for it.
 *
 * Data-free: no Convex calls, no React.
 */
import type { FunctionReturnType } from "convex/server"
import { ConvexError } from "convex/values"
import type { api } from "../../../convex/_generated/api"

/** The whole Manage-inbox read surface (PLAN §4 "Manage inbox"). */
export type InboxConnectionView = FunctionReturnType<
  typeof api.inbox.connection.getInboxConnection
>

export type InboxSyncView = InboxConnectionView["sync"]

type VerifyResult = FunctionReturnType<
  typeof api.inbox.connectActions.verifyAndStoreKey
>

/** One mailbox on the pasted key's account, offered for the user to pick. */
export type VerifiedInbox = Extract<
  VerifyResult,
  { ok: true }
>["inboxes"][number]

export type InboxConnectErrorCode = Extract<VerifyResult, { ok: false }>["code"]

/**
 * Our words for every refusal the connect flow can return. AgentMail is named
 * because the user pastes that key themselves (PLAN §4 white-label rule); no
 * other provider is, and no provider sentence is passed through.
 */
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
    "That inbox is already the sending inbox of another workspace. Pick a different one.",
  inbox_not_visible_to_key:
    "That key cannot see this workspace's inbox. Use a key from the same AgentMail account, or disconnect first to move to a different mailbox.",
  webhook_registration_failed:
    "We could not set up inbound mail for that inbox. Try again.",
  not_connected: "Connect an inbox before replacing its key.",
}

export function connectErrorCopy(code: InboxConnectErrorCode): string {
  return INBOX_CONNECT_ERROR_COPY[code]
}

/**
 * Copy for a THROWN refusal — the guards and the per-user rate limit, which
 * are `ConvexError`s rather than a returned failure. The backend's own
 * message is for logs, so it is never rendered.
 */
export function requestErrorCopy(error: unknown, fallback: string): string {
  const code =
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
      ? (error.data as { code: unknown }).code
      : undefined
  switch (code) {
    case "RATE_LIMITED":
      return "Too many attempts in a row. Wait a moment and try again."
    case "FORBIDDEN":
      return "Only the workspace owner can change the sending inbox."
    case "UNAUTHENTICATED":
      return "Your session expired. Sign in again to change the sending inbox."
    case "INVALID":
      return "That value was not accepted. Check it and try again."
    default:
      return fallback
  }
}

/** The status pill beside "Sending inbox". */
export function connectionStatusLabel(view: InboxConnectionView): string {
  switch (view.connection) {
    case "connected":
      return view.status === "invalid" ? "Key invalid" : "Connected"
    case "invalid":
      return "Key invalid"
    case "legacy_platform_inbox":
      return "Receive only"
    case "none":
      return "Not connected"
  }
}

/** The import's state in words (PLAN §4 step 5: "Syncing n threads…"). */
export function syncLabel(sync: InboxSyncView): string {
  switch (sync.state) {
    case "idle":
      return "Preparing to import your recent threads…"
    case "importing":
      return sync.threads === 1
        ? "Syncing 1 thread…"
        : `Syncing ${sync.threads} threads…`
    case "imported":
      return sync.threads === 0
        ? "Synced — no threads in the last 30 days"
        : sync.threads === 1
          ? "Synced 1 thread from the last 30 days"
          : `Synced ${sync.threads} threads from the last 30 days`
    case "failed":
      return "The 30-day import did not finish"
  }
}

/** Trimmed inbox username, as the create form will send it. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}
