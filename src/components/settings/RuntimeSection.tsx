import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/lib/convex-error"

type RuntimeStatus = FunctionReturnType<
  typeof api.runtimeConnections.getStatus
>

/** The union variant carrying runtime state — only present once a
 *  connection row exists (`exists:boolean` does not discriminate). */
type ConnectedStatus = Extract<RuntimeStatus, { state: string }>

function statusLabel(status: RuntimeStatus | undefined): string {
  if (status === undefined) {
    return "Checking…"
  }
  if (!("state" in status)) {
    return "Not connected"
  }
  switch (status.state) {
    case "provisioning":
      return "Provisioning Box…"
    case "connecting":
      return "Waiting for worker…"
    case "ready":
      return status.live ? "Connected" : "Connected — heartbeat stale"
    case "stopping":
      return "Stopping…"
    case "stopped":
      return "Stopped"
    case "disconnected":
      return "Disconnected"
    case "error":
      return "Error"
    default:
      return status.state ?? "Unknown"
  }
}

/**
 * The workspace Codex runtime (P07): one isolated ASCII Box running Codex
 * App Server, reachable only through the scoped worker bridge.
 *
 * The controls here are REAL backend calls — Connect provisions a Box via
 * the runtime lifecycle ledger, Disconnect stops it and revokes worker
 * credentials, and Start sign-in enqueues the managed device-code login the
 * worker executes (the owner-only challenge URL/code renders below while it
 * is live). Acceptance of the full end-to-end Box flow is the P13 gate;
 * this card never implies a connection that does not exist.
 */
export function RuntimeSection({
  workspace,
  isOwner,
}: {
  workspace: Doc<"workspaces">
  isOwner: boolean
}) {
  const status = useQuery(api.runtimeConnections.getStatus, {
    workspaceId: workspace._id,
  })
  const challenge = useQuery(
    api.runtimeControlRequests.getLoginChallenge,
    isOwner ? { workspaceId: workspace._id } : "skip",
  )

  const connect = useMutation(api.runtimeConnections.connect)
  const reconnect = useMutation(api.runtimeConnections.reconnect)
  const disconnect = useMutation(api.runtimeConnections.disconnect)
  const startLogin = useMutation(api.runtimeControlRequests.startLogin)
  const cancelLogin = useMutation(api.runtimeControlRequests.cancelLogin)

  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = (key: string, call: () => Promise<unknown>) => {
    setPending(key)
    setError(null)
    void call()
      .catch((cause) => {
        setError(errorMessage(cause, "Runtime request failed."))
      })
      .finally(() => {
        setPending(null)
      })
  }

  const conn: ConnectedStatus | null =
    status !== undefined && "state" in status ? status : null
  const canConnect =
    status !== undefined &&
    (conn === null ||
      conn.state === "disconnected" ||
      conn.state === "stopped" ||
      conn.state === "error")
  const canDisconnect =
    conn !== null &&
    (conn.state === "provisioning" ||
      conn.state === "connecting" ||
      conn.state === "ready")
  const canReconnect =
    conn !== null &&
    (conn.state === "ready" ||
      conn.state === "stopped" ||
      conn.state === "error")
  const canStartLogin =
    conn !== null &&
    conn.state === "ready" &&
    conn.codexAccountSummary?.state !== "chatgpt"
  const signedIn = conn?.codexAccountSummary?.state === "chatgpt"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex runtime</CardTitle>
        <CardDescription>
          The workspace's isolated Codex App Server inside its own ASCII Box —
          employees cannot run without it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {statusLabel(status)}
          </span>
          {conn !== null ? (
            <span className="text-xs text-muted-foreground">
              generation {conn.generation}
            </span>
          ) : null}
          {conn?.live === true ? (
            <span className="text-xs text-muted-foreground">
              worker heartbeat live
            </span>
          ) : null}
          {signedIn ? (
            <span className="rounded-full bg-chart-2/15 px-2 py-0.5 text-xs text-chart-2">
              Codex signed in
              {conn?.codexAccountSummary?.planType !== undefined
                ? ` (${conn.codexAccountSummary.planType})`
                : ""}
            </span>
          ) : null}
        </div>

        {conn !== null && conn.error !== undefined ? (
          <p className="text-sm text-destructive">{conn.error}</p>
        ) : null}

        {challenge !== undefined && challenge !== null ? (
          <div className="flex flex-col gap-1 rounded-2xl border border-border px-4 py-3">
            <p className="text-sm font-medium">Finish Codex sign-in</p>
            <p className="text-sm text-muted-foreground">
              Open{" "}
              <a
                href={challenge.verificationUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                the verification page
              </a>{" "}
              and enter code{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {challenge.userCode}
              </code>
              . The challenge expires{" "}
              {new Date(challenge.expiresAt).toLocaleTimeString()}.
            </p>
            {isOwner ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() =>
                    run("cancelLogin", () =>
                      cancelLogin({ workspaceId: workspace._id }),
                    )
                  }
                >
                  Cancel sign-in
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <FormError message={error} />

        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            {canConnect ? (
              <Button
                size="sm"
                disabled={pending !== null}
                onClick={() =>
                  run("connect", () =>
                    connect({ workspaceId: workspace._id }),
                  )
                }
              >
                {pending === "connect" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Connect
              </Button>
            ) : null}
            {canReconnect ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() =>
                  run("reconnect", () =>
                    reconnect({ workspaceId: workspace._id }),
                  )
                }
              >
                {pending === "reconnect" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Reconnect
              </Button>
            ) : null}
            {canStartLogin ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() =>
                  run("startLogin", () =>
                    startLogin({ workspaceId: workspace._id }),
                  )
                }
              >
                {pending === "startLogin" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Start Codex sign-in
              </Button>
            ) : null}
            {canDisconnect ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() =>
                  run("disconnect", () =>
                    disconnect({ workspaceId: workspace._id }),
                  )
                }
              >
                {pending === "disconnect" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Disconnect
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only the workspace owner manages the runtime connection.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          End-to-end acceptance of provisioning and in-Box Codex sign-in is the
          P13 gate; this panel reports only recorded backend state.
        </p>
      </CardContent>
    </Card>
  )
}
