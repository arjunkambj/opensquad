/**
 * The connected state of Manage inbox (PLAN §4: key status, sending address,
 * webhook health, sync status, Disconnect).
 *
 * Everything on it is a fact the backend reported — the key is shown as its
 * last four digits and never in full, and "last mail received" is the real
 * time of the last inbound message, or an honest "nothing yet".
 *
 * Presentational: the caller owns every action.
 */
import { Chip, DetailRow, formatInstant, formatWaited } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { InboxConnectionView } from "./inbox-connection-model"
import { connectionStatusLabel } from "./inbox-connection-model"
import { InboxSyncStatus } from "./InboxSyncStatus"

export function ConnectedInbox({
  view,
  busy,
  onReplaceKey,
  onDisconnect,
  onRetrySync,
  retryingSync = false,
}: {
  view: InboxConnectionView
  busy: boolean
  onReplaceKey: () => void
  onDisconnect: () => void
  onRetrySync?: () => void
  retryingSync?: boolean
}) {
  const keyValid = view.status === "valid"
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">
            {view.inboxAddress ?? "Sending inbox"}
          </p>
          <p className="text-xs text-muted-foreground">
            Outreach goes out from here, and replies come back to it.
          </p>
        </div>
        <Chip
          className={cn(
            keyValid
              ? "bg-primary/10 text-primary"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {connectionStatusLabel(view)}
        </Chip>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <DetailRow
          label="API key"
          value={
            view.last4 === undefined
              ? "Not stored"
              : `•••• ${view.last4} · ${keyValid ? "verified" : "refused by AgentMail"}`
          }
        />
        <DetailRow
          label="Inbound mail"
          value={
            view.webhook.registered
              ? "Webhook registered on your account"
              : "No webhook registered"
          }
        />
        <DetailRow
          label="Last mail received"
          value={
            view.lastEventAt === undefined
              ? "Nothing yet"
              : `${formatWaited(view.lastEventAt)} · ${formatInstant(view.lastEventAt)}`
          }
        />
        <DetailRow
          label="Connected"
          value={
            view.connectedAt === undefined
              ? "Not recorded"
              : formatInstant(view.connectedAt)
          }
        />
      </div>

      <InboxSyncStatus
        sync={view.sync}
        {...(onRetrySync !== undefined ? { onRetry: onRetrySync } : {})}
        retrying={retryingSync}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onReplaceKey}
        >
          Replace key
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
    </div>
  )
}
