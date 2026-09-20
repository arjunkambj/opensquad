/**
 * The write half of Manage inbox: verify, connect, rotate, disconnect, and
 * resume a failed import — plus the flow state that says which of them the
 * screen is offering.
 *
 * It lives beside the container rather than inside it so the container stays
 * a rendering decision. Two rules are enforced here:
 *
 *   THE KEY IS NEVER RETAINED. A pasted key is an argument and nothing else —
 *   never state, never a ref, never a toast.
 *
 *   FAILURES ARE OURS. The actions answer with a closed set of codes plus an
 *   operator-facing message; only the code is read, and the copy comes from
 *   `inbox-connection-model` (PLAN §4 white-label rule).
 */
import { useAction } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { toast } from "@/components/ui/toast"
import type { InboxChoice } from "./InboxPicker"
import type { VerifiedInbox } from "./inbox-connection-model"
import { connectErrorCopy, requestErrorCopy } from "./inbox-connection-model"

/** What the user is doing, where that is not simply the stored state. */
export type InboxConnectFlow =
  | { kind: "idle" }
  | { kind: "picking"; last4: string; inboxes: readonly VerifiedInbox[] }
  | { kind: "rotating" }

export type InboxConnectBusy =
  | "none"
  | "verifying"
  | "connecting"
  | "rotating"
  | "disconnecting"

export type InboxConnectActions = {
  flow: InboxConnectFlow
  busy: InboxConnectBusy
  error: string | null
  resyncing: boolean
  /** Leave the current sub-form and clear its error. */
  reset: () => void
  startRotation: () => void
  verify: (apiKey: string) => void
  connect: (choice: InboxChoice) => void
  rotate: (apiKey: string) => void
  disconnect: (onDone: () => void) => void
  resumeImport: (inboxId: string) => void
}

export function useInboxConnectActions(
  workspaceId: Id<"workspaces">,
): InboxConnectActions {
  const verifyAndStoreKey = useAction(
    api.inbox.connectActions.verifyAndStoreKey,
  )
  const connectInbox = useAction(api.inbox.connectActions.connectInbox)
  const rotateKey = useAction(api.inbox.connectActions.rotateKey)
  const disconnectInbox = useAction(api.inbox.connectActions.disconnectInbox)

  const [flow, setFlow] = useState<InboxConnectFlow>({ kind: "idle" })
  const [busy, setBusy] = useState<InboxConnectBusy>("none")
  const [error, setError] = useState<string | null>(null)
  const [resyncing, setResyncing] = useState(false)

  const run = async (
    state: InboxConnectBusy,
    call: () => Promise<void>,
    fallback: string,
  ) => {
    setBusy(state)
    setError(null)
    try {
      await call()
    } catch (cause) {
      setError(requestErrorCopy(cause, fallback))
    } finally {
      setBusy("none")
    }
  }

  return {
    flow,
    busy,
    error,
    resyncing,
    reset: () => {
      setFlow({ kind: "idle" })
      setError(null)
    },
    startRotation: () => {
      setError(null)
      setFlow({ kind: "rotating" })
    },

    verify: (apiKey) => {
      void run(
        "verifying",
        async () => {
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
        },
        "We could not check that key.",
      )
    },

    connect: (choice) => {
      void run(
        "connecting",
        async () => {
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
        },
        "We could not connect that inbox.",
      )
    },

    rotate: (apiKey) => {
      void run(
        "rotating",
        async () => {
          const result = await rotateKey({ workspaceId, apiKey })
          if (!result.ok) {
            setError(connectErrorCopy(result.code))
            return
          }
          setFlow({ kind: "idle" })
          toast.add({ title: "Key replaced", type: "success" })
        },
        "We could not replace that key.",
      )
    },

    disconnect: (onDone) => {
      void run(
        "disconnecting",
        async () => {
          await disconnectInbox({ workspaceId })
          setFlow({ kind: "idle" })
          onDone()
          toast.add({ title: "Inbox disconnected", type: "success" })
        },
        "We could not disconnect the inbox.",
      )
    },

    /**
     * Resume a failed import by re-connecting the SAME inbox: the claim keeps
     * `connectedAt`, so the import resumes from its stored cursor instead of
     * starting over, and the webhook registration is idempotent.
     */
    resumeImport: (inboxId) => {
      setResyncing(true)
      setError(null)
      void (async () => {
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
      })()
    },
  }
}
