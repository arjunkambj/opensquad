import { useState } from "react"
import type { Id } from "../../../convex/_generated/dataModel"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { LoadingState } from "@/components/states/states"
import { ConnectedInbox } from "./ConnectedInbox"
import { DisconnectInboxDialog } from "./DisconnectInboxDialog"
import { InboxKeyForm } from "./InboxKeyForm"
import { InboxPicker } from "./InboxPicker"
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
    return (
      <LoadingState
        title="Reading your inbox connection"
        description="Checking the stored key, the inbound webhook and the import."
      />
    )
  }

  if (access.state === "no_org") {
    return (
      <p className="text-sm text-muted-foreground">
        We could not read your organization just now. Refresh the page and try
        again.
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

  if (flow.kind === "rotating") {
    return (
      <InboxKeyForm
        id="inbox-rotate-key"
        label="New AgentMail API key"
        description="The new key must belong to the same AgentMail account as the connected inbox. Mail keeps arriving during the swap."
        submitLabel="Replace key"
        busy={busy === "rotating"}
        error={error}
        onSubmit={actions.rotate}
        onCancel={actions.reset}
      />
    )
  }

  if (view.connection === "connected") {
    const inboxAddress = view.inboxAddress
    return (
      <>
        <ConnectedInbox
          view={view}
          busy={busy !== "none"}
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
        {error !== null && !confirmingDisconnect ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
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
          Sending is paused and replies are not being read. Paste a new key
          from the same account to pick up where you left off — nothing is
          lost.
        </InfoBanner>
        <InboxKeyForm
          id="inbox-reconnect-key"
          label="AgentMail API key"
          description={
            view.last4 === undefined
              ? "Paste a key from the account that owns this organization's inbox."
              : `The stored key ending ${view.last4} no longer works. Paste a current one from the same account.`
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
    <div className="flex flex-col gap-4">
      <InboxKeyForm
        id="inbox-connect-key"
        label="AgentMail API key"
        description={
          view.last4 === undefined
            ? "From your AgentMail dashboard. It is encrypted before it is stored and never shown again."
            : `A key ending ${view.last4} is stored but no inbox is attached yet. Paste it again to choose one.`
        }
        submitLabel="Verify key"
        busy={busy === "verifying"}
        error={error}
        onSubmit={actions.verify}
      />
    </div>
  )
}
