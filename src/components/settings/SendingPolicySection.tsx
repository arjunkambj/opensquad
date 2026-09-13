import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import {
  SendPolicyFields,
  type SendPolicyValues,
} from "@/components/settings/SendPolicyFields"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import {
  minutesToTimeString,
  timeStringToMinutes,
} from "@/lib/workspace-time"

/**
 * Sending window and daily limit (owner-only), via `setSendingPolicy` guarded
 * by `expectedPolicyVersion`. A stale version returns CONFLICT and the form
 * resyncs to the authoritative record.
 */
export function SendingPolicySection({
  workspace,
  isOwner,
}: {
  workspace: Doc<"workspaces">
  isOwner: boolean
}) {
  const setSendingPolicy = useMutation(api.workspaces.setSendingPolicy)

  const [form, setForm] = useState<SendPolicyValues>({
    weekdays: [...workspace.sendWindow.weekdays],
    startTime: minutesToTimeString(workspace.sendWindow.startMinute),
    endTime: minutesToTimeString(workspace.sendWindow.endMinute),
    dailySendLimit: String(workspace.dailySendLimit),
  })
  const [syncedAt, setSyncedAt] = useState(workspace.updatedAt)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync on `updatedAt` so concurrent edits anywhere on the record resync.
  if (workspace.updatedAt !== syncedAt && !dirty) {
    setSyncedAt(workspace.updatedAt)
    setForm({
      weekdays: [...workspace.sendWindow.weekdays],
      startTime: minutesToTimeString(workspace.sendWindow.startMinute),
      endTime: minutesToTimeString(workspace.sendWindow.endMinute),
      dailySendLimit: String(workspace.dailySendLimit),
    })
  }

  const validate = (): string | null => {
    if (form.weekdays.length === 0) {
      return "Pick at least one sending day."
    }
    const start = timeStringToMinutes(form.startTime)
    const end = timeStringToMinutes(form.endTime)
    if (start === undefined || end === undefined) {
      return "Sending window times must be valid HH:MM values."
    }
    if (start >= end) {
      return "Sending window start must be before its end."
    }
    const limit = Number(form.dailySendLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return "Daily send limit must be an integer between 1 and 1000."
    }
    return null
  }

  const save = async () => {
    const problem = validate()
    if (problem !== null) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await setSendingPolicy({
        workspaceId: workspace._id,
        expectedPolicyVersion: workspace.policyVersion,
        dailySendLimit: Number(form.dailySendLimit),
        sendWindow: {
          weekdays: form.weekdays,
          startMinute: timeStringToMinutes(form.startTime) ?? 0,
          endMinute: timeStringToMinutes(form.endTime) ?? 0,
        },
      })
      setDirty(false)
      toast.add({ title: "Sending policy saved", type: "success" })
    } catch (cause) {
      if (isConflictError(cause)) {
        setDirty(false)
        setError(
          "Sending policy changed in another session. The latest values were loaded — review them and save again.",
        )
      } else {
        setError(errorMessage(cause, "Could not save the sending policy."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending policy</CardTitle>
        <CardDescription>
          When employees may send approved email, and the per-day ceiling.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <SendPolicyFields
            values={form}
            disabled={!isOwner}
            onChange={(next) => {
              setDirty(true)
              setForm(next)
            }}
          />
          <FormError message={error} />
          {isOwner ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                {saving ? <Spinner data-icon="inline-start" /> : null}
                Save sending policy
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only the workspace owner can change the sending policy.
            </p>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
