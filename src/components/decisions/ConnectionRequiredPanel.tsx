import { Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import { DecisionActionDialog } from "@/components/decisions/DecisionActionDialog"
import type { WorkspaceRole } from "@/components/decisions/DecisionDetail"
import type { DecisionPanelProps } from "@/components/decisions/decision-presentation"
import {
  DetailRow,
  formatInstant,
} from "@/components/decisions/decision-presentation"
import { useDecisionIntents } from "@/components/decisions/use-decision-intent"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"

const MAX_NOTE = 4000

/**
 * `connection_required` — the ask an operator can read and cannot fix.
 *
 * Connecting the runtime is owner-only (`runtimeConnections.connect`), while
 * resolving a decision needs owner *or* operator. That asymmetry is the whole
 * design problem of this screen: an operator is allowed to close the ask but
 * not to do the thing the ask is about. So the split is stated in words rather
 * than expressed as a disabled button nobody can explain.
 *
 * The live runtime state is shown from `runtimeConnections.getStatus`, which
 * is the same signal the rest of the app trusts — `live` is `ready` plus a
 * fresh heartbeat, and it degrades visibly rather than animating hopefully.
 */
export function ConnectionRequiredPanel({
  workspaceId,
  decision,
  expectedVersion,
  canAct,
  actionNotice,
  role,
}: DecisionPanelProps & { role: WorkspaceRole }) {
  const runtime = useQuery(api.runtimeConnections.getStatus, { workspaceId })
  const resolve = useMutation(api.decisions.resolve)
  const intentId = useDecisionIntents()

  const [note, setNote] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = note.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_NOTE

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await resolve({
        workspaceId,
        decisionId: decision._id,
        expectedVersion,
        requestId: intentId(decision._id, "connection_resolved"),
        answer: { approved: true, body: trimmed },
      })
      toast.add({
        title: "Ask resolved",
        description: "The waiting work was signalled to continue.",
        type: "success",
      })
      setConfirming(false)
    } catch (cause) {
      setError(
        isConflictError(cause)
          ? `${errorMessage(cause, "This ask moved while you had it open.")} Nothing was written and your note is still here — review the ask above, then submit again.`
          : errorMessage(cause, "Could not resolve this ask."),
      )
    } finally {
      setBusy(false)
    }
  }

  if (runtime === undefined) {
    return (
      <LoadingState
        title="Loading connection state"
        description="Reading the runtime's real state, not a guess."
      />
    )
  }

  // `exists: boolean` is present on both variants, so it cannot discriminate
  // them; the presence of `state` is what tells a real connection row from
  // "this workspace has never connected one".
  const connection = "state" in runtime ? runtime : undefined

  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Runtime connection</CardTitle>
          <CardDescription>
            {connection === undefined
              ? "This workspace has never connected a runtime."
              : connection.live
                ? "The runtime is connected and its heartbeat is fresh."
                : "A runtime exists but is not reporting as live right now."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DetailRow
            label="Status"
            value={
              connection === undefined
                ? "never connected"
                : connection.live
                  ? "connected"
                  : `not live (${connection.state})`
            }
          />
          {connection?.lastHeartbeatAt === undefined ? null : (
            <DetailRow
              label="Last heartbeat"
              value={formatInstant(connection.lastHeartbeatAt)}
            />
          )}
          {connection?.error === undefined ? null : (
            <DetailRow label="Reported error" value={connection.error} />
          )}

          {role === "owner" ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              render={
                <Link to="/settings" search={{ section: "runtime" }} />
              }
            >
              Open runtime settings
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only the workspace owner can connect or reconnect the runtime.
              You can read this ask and, once an owner has connected it, record
              that it is resolved.
            </p>
          )}
        </CardContent>
      </Card>

      {actionNotice}
      {canAct ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Record that this is handled</CardTitle>
            <CardDescription>
              Resolving does not connect anything — it tells the waiting work
              that a human dealt with the blocker. Say what you did, so the
              record is worth reading later.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="connection-note">What you did (required)</Label>
              <Textarea
                id="connection-note"
                value={note}
                maxLength={MAX_NOTE}
                onChange={(event) => setNote(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {trimmed.length} / {MAX_NOTE} characters.
              </p>
            </div>
            {connection?.live === true ? null : (
              <p className="text-sm text-muted-foreground">
                The runtime is not reporting as live. You can still resolve this
                ask, but the work it releases may block again immediately.
              </p>
            )}
            <div>
              <Button disabled={!valid} onClick={() => setConfirming(true)}>
                Resolve this ask
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DecisionActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Resolve this ask"
        description="This records your note as the answer and releases the work that was waiting. It cannot be edited afterwards."
        confirmLabel="Resolve"
        confirmDisabled={!valid}
        busy={busy}
        error={error}
        onConfirm={() => void submit()}
      >
        <p className="text-sm break-words whitespace-pre-wrap">{trimmed}</p>
      </DecisionActionDialog>
    </div>
  )
}
