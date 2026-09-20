/**
 * What became of the approved reply — read off the send ledger, never
 * inferred.
 *
 * Each attempt state has exactly one honest sentence and at most one action:
 * a reserved intent can still be cancelled because nothing has left the
 * building; an uncertain one can be reconciled with the provider; a failed or
 * cancelled one can be tried again. An acknowledged send says "sent", which
 * means the provider accepted it — never "delivered".
 */
import { useMutation } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { formatInstant } from "@/components/shared/presentation"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

type Preflight = FunctionReturnType<typeof api.outreach.sendPreflight.preflight>
type Attempt = Preflight["attempts"][number]

const ATTEMPT_LINE: Record<Attempt["state"], string> = {
  reserved: "Queued — nothing has been sent yet.",
  requesting: "Sending now.",
  acknowledged: "Sent — your mail provider accepted it.",
  uncertain: "Needs a look — we never learned whether this one went out.",
  definitively_failed: "Not sent — it never reached your mail provider.",
  cancelled: "Cancelled before it was sent.",
}

export function SendStatus({
  workspaceId,
  draftId,
  attempts,
  canAct,
}: {
  workspaceId: Id<"workspaces">
  draftId: Id<"drafts">
  attempts: Attempt[]
  canAct: boolean
}) {
  const reconcile = useMutation(api.outreach.sendControls.requestReconciliation)
  const cancel = useMutation(api.outreach.sendControls.cancelAttempt)
  const dispatch = useMutation(api.outreach.sendControls.requestDispatch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (attempts.length === 0) {
    return null
  }
  const latest = attempts[0]

  const run = (
    work: Promise<unknown>,
    title: string,
    description: string,
    failure: string,
  ) => {
    setBusy(true)
    setError(null)
    void work
      .then(() => toast.add({ title, description, type: "success" }))
      .catch((cause) => setError(errorMessage(cause, failure)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border px-4 py-3">
      <p className="text-sm text-foreground">{ATTEMPT_LINE[latest.state]}</p>
      <p className="text-xs text-muted-foreground">
        {formatInstant(latest.createdAt)}
        {attempts.length > 1 ? ` · ${attempts.length} attempts on this reply` : ""}
      </p>
      {canAct ? (
        <div className="flex flex-wrap gap-2">
          {latest.state === "uncertain" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  reconcile({ workspaceId, sendAttemptId: latest.sendAttemptId }),
                  "Checking with your mail provider",
                  "We are asking what happened to that send.",
                  "Could not check that send.",
                )
              }
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Check what happened
            </Button>
          ) : null}
          {latest.state === "reserved" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  cancel({ workspaceId, sendAttemptId: latest.sendAttemptId }),
                  "Send cancelled",
                  "Nothing went out. The reply stays here.",
                  "Could not cancel that send.",
                )
              }
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Cancel this send
            </Button>
          ) : null}
          {latest.state === "definitively_failed" || latest.state === "cancelled" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  dispatch({ workspaceId, draftId }),
                  "Trying again",
                  "Every send check runs again before anything leaves.",
                  "Could not try that send again.",
                )
              }
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      <FormError message={error} />
    </div>
  )
}
