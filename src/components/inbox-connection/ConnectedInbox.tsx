import type { ReactNode } from "react"
import { Chip } from "@/components/kit/Chip"
import { Hint } from "@/components/kit/Hint"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { formatInstant, formatWaited } from "@/lib/presentation"
import type { InboxConnectionView } from "./inbox-connection-model"
import { connectionStatusLabel } from "./inbox-connection-model"
import { InboxSyncStatus } from "./InboxSyncStatus"

export function ConnectedInbox({
  view,
  busy,
  error,
  onReplaceKey,
  onDisconnect,
  onRetrySync,
  retryingSync = false,
}: {
  view: InboxConnectionView
  busy: boolean
  error: string | null
  onReplaceKey: () => void
  onDisconnect: () => void
  onRetrySync?: () => void
  retryingSync?: boolean
}) {
  const keyValid = view.status === "valid"
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {view.inboxAddress ?? "Sending inbox"}
          </p>
          <Chip
            variant={keyValid ? "success" : "destructive"}
            className="shrink-0"
          >
            {connectionStatusLabel(view)}
          </Chip>
        </div>

        <dl className="flex flex-col gap-2.5 text-sm">
          <Fact label="API key">
            {view.last4 === undefined ? (
              "Not stored"
            ) : keyValid ? (
              `•••• ${view.last4}`
            ) : (
              <Hint content="AgentMail refused this key. Replace it to resume sending.">
                <span className="text-destructive">
                  •••• {view.last4} · refused
                </span>
              </Hint>
            )}
          </Fact>
          <Fact label="Inbound mail">
            {view.webhook.registered ? "Webhook registered" : "No webhook"}
          </Fact>
          <Fact label="Last mail">
            <Moment at={view.lastEventAt} empty="Nothing yet" />
          </Fact>
          <Fact label="Connected">
            <Moment at={view.connectedAt} empty="Not recorded" />
          </Fact>
          <Fact label="Imported">
            <InboxSyncStatus
              sync={view.sync}
              {...(onRetrySync !== undefined ? { onRetry: onRetrySync } : {})}
              retrying={retryingSync}
            />
          </Fact>
        </dl>

        <FormError message={error} />
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onReplaceKey}
        >
          Replace key
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </DialogFooter>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-5 items-center gap-3">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

/** Relative time, with the exact instant on hover. */
function Moment({ at, empty }: { at: number | undefined; empty: string }) {
  if (at === undefined) {
    return empty
  }
  return (
    <Hint content={formatInstant(at)}>
      <span>{formatWaited(at)}</span>
    </Hint>
  )
}
