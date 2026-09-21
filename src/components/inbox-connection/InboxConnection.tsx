import { useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { ConnectedInbox } from "./ConnectedInbox"
import { DisconnectInboxDialog } from "./DisconnectInboxDialog"
import { InboxConnectionSkeleton } from "./InboxConnectionSkeleton"
import { InboxKeyForm } from "./InboxKeyForm"
import { InboxPicker } from "./InboxPicker"
import { ReplaceKeyDialog } from "./ReplaceKeyDialog"
import { useInboxConnectActions } from "./use-inbox-connect-actions"
import { useInboxConnection } from "./use-inbox-connection"

export function InboxConnection({
  orgId,
}: {
  orgId: Id<"orgs">
}) {
  const access = useInboxConnection(orgId)
  const actions = useInboxConnectActions(orgId)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  if (access.state === "loading") {
    return <InboxConnectionSkeleton />
  }

  if (access.state === "no_org") {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't load your organization. Refresh to try again.
      </p>
    )
  }

  const view = access.view
  const { flow, busy, error } = actions

  if (flow.kind === "picking") {
    return (
      <InboxPicker
        inboxes={flow.inboxes}
        last4={flow.last4}
        busy={busy === "connecting"}
        busyNote="Creating the inbox and registering inbound mail…"
        error={error}
        onConnect={actions.connect}
        onBack={actions.reset}
      />
    )
  }

  if (view.connection === "connected") {
    const inboxAddress = view.inboxAddress
    const rotating = flow.kind === "rotating"
    return (
      <>
        <ConnectedInbox
          view={view}
          busy={busy !== "none"}
          error={!confirmingDisconnect && !rotating ? error : null}
          onReplaceKey={actions.startRotation}
          onDisconnect={() => {
            setConfirmingDisconnect(true)
          }}
          {...(inboxAddress !== undefined
            ? {
                onRetrySync: () => {
                  actions.resumeImport(inboxAddress)
                },
              }
            : {})}
          retryingSync={actions.resyncing}
        />
        <ReplaceKeyDialog
          open={rotating}
          busy={busy === "rotating"}
          error={rotating ? error : null}
          onSubmit={actions.rotate}
          onCancel={actions.reset}
        />
        <DisconnectInboxDialog
          open={confirmingDisconnect}
          onOpenChange={setConfirmingDisconnect}
          inboxAddress={inboxAddress}
          busy={busy === "disconnecting"}
          error={confirmingDisconnect ? error : null}
          onConfirm={() => {
            actions.disconnect(() => {
              setConfirmingDisconnect(false)
            })
          }}
        />
      </>
    )
  }

  if (view.connection === "invalid") {
    return (
      <div className="flex flex-col gap-4">
        <InfoBanner
          title="AgentMail refused this organization's key."
          className="border-destructive/30 bg-destructive/5"
        >
          Sending is paused. Paste a new key to resume.
        </InfoBanner>
        <InboxKeyForm
          id="inbox-reconnect-key"
          label="AgentMail API key"
          description={
            view.last4 === undefined
              ? "Use a key from the same account."
              : `Key ending ${view.last4} stopped working.`
          }
          submitLabel="Reconnect"
          busy={busy === "rotating"}
          error={error}
          onSubmit={actions.rotate}
        />
      </div>
    )
  }

  return (
    <InboxKeyForm
      id="inbox-connect-key"
      label="AgentMail API key"
      description={
        view.last4 === undefined
          ? "Stored encrypted, never shown again."
          : `Key ending ${view.last4} saved. Paste it again to pick an inbox.`
      }
      submitLabel="Verify key"
      busy={busy === "verifying"}
      error={error}
      onSubmit={actions.verify}
    />
  )
}
