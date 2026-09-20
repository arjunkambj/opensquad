import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import { formatInstant } from "@/components/shared/presentation"
import { FormError, LoadingState, PermissionNote } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import type { WorkspaceView } from "@/lib/workspace-view";

const REASON_LABEL: Record<Doc<"suppressions">["reason"], string> = {
  unsubscribe: "Unsubscribed",
  manual: "Added by hand",
  bounce: "Bounced",
  provider: "Provider event",
}

/**
 * The suppression list — the one thing `sending.preflight` honours as
 * "do not send", checked on the normalized email first, then the domain.
 *
 * Adding here is deliberately narrow: a kind, an address or domain, and the
 * reason is always `manual` — `unsubscribe`/`bounce`/`provider` rows are
 * written by the backend from verified provider facts, and a form that could
 * mint them would let a person fake an opt-out record. Removing is offered
 * because a manual block can be a mistake; the row is deleted outright and
 * the reason it existed stays in the activity trail.
 */
export function SuppressionsSection({
  workspace,
  role,
}: {
  workspace: WorkspaceView
  role: "owner" | "operator" | "viewer"
}) {
  const canEdit = role === "owner" || role === "operator"
  const rows = useQuery(api.outreach.suppressions.list, { workspaceId: workspace._id })
  const add = useMutation(api.outreach.suppressions.add)
  const remove = useMutation(api.outreach.suppressions.remove)

  const [kind, setKind] = useState<"email" | "domain">("email")
  const [value, setValue] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (value.trim() === "" || pending !== null) {
      return
    }
    setPending("add")
    setError(null)
    void add({
      workspaceId: workspace._id,
      kind,
      value: value.trim(),
      reason: "manual",
    })
      .then((result) => {
        setValue("")
        toast.add({
          title: result.created ? "Suppressed" : "Already suppressed",
          description: result.created
            ? "Sends and resumes now refuse this address."
            : "That entry was already on the list.",
          type: "success",
        })
      })
      .catch((cause) =>
        setError(errorMessage(cause, "Could not add the suppression.")),
      )
      .finally(() => setPending(null))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suppressed addresses</CardTitle>
        <CardDescription>
          Addresses and whole domains the squad must never mail — unsubscribes,
          bounces and blocks added here. The send boundary checks this list
          before every send, and resuming a frozen thread checks it too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows === undefined ? (
          <LoadingState title="Loading suppressions" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is suppressed. A verified unsubscribe or bounce lands here
            on its own; add an address by hand when a person asks to be left
            alone off-channel.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row._id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-border px-3 py-2"
              >
                <span className="font-mono text-sm text-foreground">
                  {row.normalizedValue}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {row.kind === "domain" ? "whole domain" : "address"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {REASON_LABEL[row.reason]} · {formatInstant(row.createdAt)}
                </span>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="ml-auto"
                    disabled={pending !== null}
                    onClick={() => {
                      setPending(row._id)
                      setError(null)
                      void remove({
                        workspaceId: workspace._id,
                        suppressionId: row._id,
                      })
                        .then(() =>
                          toast.add({
                            title: "Suppression removed",
                            description:
                              "Sends to this address are no longer refused on this entry.",
                            type: "success",
                          }),
                        )
                        .catch((cause) =>
                          setError(
                            errorMessage(
                              cause,
                              "Could not remove the suppression.",
                            ),
                          ),
                        )
                        .finally(() => setPending(null))
                    }}
                  >
                    {pending === row._id ? (
                      <Spinner data-icon="inline-start" />
                    ) : null}
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="suppression-kind">Kind</Label>
                <NativeSelect
                  id="suppression-kind"
                  className="w-32"
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as "email" | "domain")
                  }
                >
                  <option value="email">Address</option>
                  <option value="domain">Domain</option>
                </NativeSelect>
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <Label htmlFor="suppression-value">
                  {kind === "email" ? "Email address" : "Domain"}
                </Label>
                <Input
                  id="suppression-value"
                  value={value}
                  placeholder={
                    kind === "email" ? "name@example.com" : "example.com"
                  }
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      submit()
                    }
                  }}
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending !== null || value.trim() === ""}
                onClick={submit}
              >
                {pending === "add" ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Suppress
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A domain row blocks every address on it — use it only when no
              mail to that company should ever go out.
            </p>
          </div>
        ) : (
          <PermissionNote role={role} action="add or remove suppressions" />
        )}
        <FormError message={error} />
      </CardContent>
    </Card>
  )
}
