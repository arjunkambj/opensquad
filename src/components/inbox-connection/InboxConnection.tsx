/**
 * Manage inbox — the one container behind both onboarding dot 3 and
 * Settings → Inbox (PLAN §4 "Manage inbox", EXECUTION T22).
 *
 * It owns every Convex call of the flow and passes plain props to the
 * presentational parts beside it: paste key → verify → pick or create an
 * inbox → the import's progress → the connected state, with Replace key and
 * Disconnect.
 *
 * THE KEY IS NEVER RETAINED. A pasted key travels from the form into the
 * action call and nowhere else — not into state, not into a ref, not into a
 * toast. What survives is the last four digits the backend returns.
 *
 * FAILURES ARE OURS. The connect actions answer with a closed set of codes
 * plus an operator-facing message; only the code is read, and the copy comes
 * from `inbox-connection-model`. Thrown refusals (owner guard, per-user rate
 * limit) are mapped the same way.
 *
 * THE READ IS OWNER-GUARDED, so the role is checked here and the query is
 * skipped for anyone else: a non-owner gets the permission note rather than a
 * thrown query that would take the whole screen down.
 */
import { useAction, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { LoadingState, PermissionNote } from "@/components/states/states"
import { toast } from "@/components/ui/toast"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { ConnectedInbox } from "./ConnectedInbox"
import { DisconnectInboxDialog } from "./DisconnectInboxDialog"
import { InboxKeyForm } from "./InboxKeyForm"
import type { InboxChoice } from "./InboxPicker"
import { InboxPicker } from "./InboxPicker"
import type { VerifiedInbox } from "./inbox-connection-model"
import { connectErrorCopy, requestErrorCopy } from "./inbox-connection-model"

/** What the user is doing, where that is not simply the stored state. */
type Flow =
  | { kind: "idle" }
  | { kind: "picking"; last4: string; inboxes: readonly VerifiedInbox[] }
  | { kind: "rotating" }

type Busy = "none" | "verifying" | "connecting" | "rotating" | "disconnecting"

export function InboxConnection({
  workspaceId,
  onConnected,
}: {
  workspaceId: Id<"workspaces">
  /** Fired once a connect or a rotation has succeeded. */
  onConnected?: () => void
}) {
  const current = useCurrentWorkspace()
  const isOwner =
    current !== undefined &&
    current !== null &&
    current.workspace._id === workspaceId &&
    current.role === "owner"
  const view = useQuery(
    api.inbox.connection.getInboxConnection,
    isOwner ? { workspaceId } : "skip",
  )
  const verifyAndStoreKey = useAction(
    api.inbox.connectActions.verifyAndStoreKey,
  )
  const connectInbox = useAction(api.inbox.connectActions.connectInbox)
  const rotateKey = useAction(api.inbox.connectActions.rotateKey)
  const disconnectInbox = useAction(api.inbox.connectActions.disconnectInbox)

  const [flow, setFlow] = useState<Flow>({ kind: "idle" })
  const [busy, setBusy] = useState<Busy>("none")
  const [error, setError] = useState<string | null>(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [resyncing, setResyncing] = useState(false)

  if (current === undefined || (isOwner && view === undefined)) {
    return (
      <LoadingState
        title="Reading your inbox connection"
        description="Checking the stored key, the inbound webhook and the import."
      />
    )
  }

  if (current === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Finish setup to create your workspace before connecting an inbox.
      </p>
    )
  }

  if (!isOwner || view === undefined) {
    return (
      <PermissionNote
        role={current.role}
        action="connect or change the sending inbox"
      />
    )
  }

  const verify = async (apiKey: string) => {
    setBusy("verifying")
    setError(null)
    try {
      const result = await verifyAndStoreKey({ workspaceId, apiKey })
      if (!result.ok) {
        setError(connectErrorCopy(result.code))
        return
      }
      setFlow({
        kind: "picking",
        last4: result.last4,
        inboxes: result.inboxes,
      })
    } catch (cause) {
      setError(requestErrorCopy(cause, "We could not check that key."))
    } finally {
      setBusy("none")
    }
  }

  const connect = async (choice: InboxChoice) => {
    setBusy("connecting")
    setError(null)
    try {
      const result = await connectInbox({
        workspaceId,
        ...(choice.kind === "existing"
          ? { inboxId: choice.inboxId }
          : {
              username: choice.username,
              ...(choice.displayName.length > 0
                ? { displayName: choice.displayName }
                : {}),
            }),
      })
      if (!result.ok) {
        setError(connectErrorCopy(result.code))
        return
      }
      setFlow({ kind: "idle" })
      toast.add({
        title: `Sending from ${result.inboxAddress}`,
        description: "Importing your recent threads now.",
        type: "success",
      })
      onConnected?.()
    } catch (cause) {
      setError(requestErrorCopy(cause, "We could not connect that inbox."))
    } finally {
      setBusy("none")
    }
  }

  const rotate = async (apiKey: string) => {
    setBusy("rotating")
    setError(null)
    try {
      const result = await rotateKey({ workspaceId, apiKey })
      if (!result.ok) {
        setError(connectErrorCopy(result.code))
        return
      }
      setFlow({ kind: "idle" })
      toast.add({ title: "Key replaced", type: "success" })
      onConnected?.()
    } catch (cause) {
      setError(requestErrorCopy(cause, "We could not replace that key."))
    } finally {
      setBusy("none")
    }
  }

  const disconnect = async () => {
    setBusy("disconnecting")
    setError(null)
    try {
      await disconnectInbox({ workspaceId })
      setConfirmingDisconnect(false)
      setFlow({ kind: "idle" })
      toast.add({ title: "Inbox disconnected", type: "success" })
    } catch (cause) {
      setError(requestErrorCopy(cause, "We could not disconnect the inbox."))
    } finally {
      setBusy("none")
    }
  }

  /**
   * Resume a failed import by re-connecting the SAME inbox: the claim keeps
   * `connectedAt`, so the import resumes from its stored cursor instead of
   * starting over, and the webhook registration is idempotent.
   */
  const resumeImport = async (inboxId: string) => {
    setResyncing(true)
    setError(null)
    try {
      const result = await connectInbox({ workspaceId, inboxId })
      if (!result.ok) {
        setError(connectErrorCopy(result.code))
      }
    } catch (cause) {
      setError(requestErrorCopy(cause, "We could not resume the import."))
    } finally {
      setResyncing(false)
    }
  }

  if (flow.kind === "picking") {
    return (
      <InboxPicker
        inboxes={flow.inboxes}
        last4={flow.last4}
        busy={busy === "connecting"}
        busyNote="Creating the inbox and registering inbound mail…"
        error={error}
        onConnect={(choice) => {
          void connect(choice)
        }}
        onBack={() => {
          setFlow({ kind: "idle" })
          setError(null)
        }}
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
        onSubmit={(apiKey) => {
          void rotate(apiKey)
        }}
        onCancel={() => {
          setFlow({ kind: "idle" })
          setError(null)
        }}
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
          onReplaceKey={() => {
            setError(null)
            setFlow({ kind: "rotating" })
          }}
          onDisconnect={() => {
            setError(null)
            setConfirmingDisconnect(true)
          }}
          {...(inboxAddress !== undefined
            ? {
                onRetrySync: () => {
                  void resumeImport(inboxAddress)
                },
              }
            : {})}
          retryingSync={resyncing}
        />
        {error !== null && !confirmingDisconnect ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DisconnectInboxDialog
          open={confirmingDisconnect}
          onOpenChange={(open) => {
            setConfirmingDisconnect(open)
            if (!open) {
              setError(null)
            }
          }}
          inboxAddress={inboxAddress}
          busy={busy === "disconnecting"}
          error={confirmingDisconnect ? error : null}
          onConfirm={() => {
            void disconnect()
          }}
        />
      </>
    )
  }

  if (view.connection === "invalid") {
    return (
      <div className="flex flex-col gap-4">
        <InfoBanner
          title="AgentMail refused this workspace's key."
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
              ? "Paste a key from the account that owns this workspace's inbox."
              : `The stored key ending ${view.last4} no longer works. Paste a current one from the same account.`
          }
          submitLabel="Reconnect"
          busy={busy === "rotating"}
          error={error}
          onSubmit={(apiKey) => {
            void rotate(apiKey)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {view.connection === "legacy_platform_inbox" ? (
        <InfoBanner title="This workspace is on a shared inbox.">
          It can receive and read mail, but it cannot send. Connect your own
          AgentMail key to send from an address you control.
        </InfoBanner>
      ) : null}
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
        onSubmit={(apiKey) => {
          void verify(apiKey)
        }}
      />
    </div>
  )
}
