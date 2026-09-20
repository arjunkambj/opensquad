import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import { FormError } from "@/components/states/states"
import {
  type WorkspacePolicyForm,
  workspaceToForm,
} from "@/components/onboarding/onboarding-model"
import { SendPolicyFields } from "@/components/settings/SendPolicyFields"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import {
  detectLocalTimezone,
  timeStringToMinutes,
  timezoneOptions,
} from "@/lib/workspace-time"

/**
 * Step 2 — workspace name, timezone and the conservative send policy.
 *
 * `workspaces.update` handles name/timezone; a real timezone change requires
 * the current `expectedPolicyVersion` and bumps `policyVersion`. The sending
 * policy then saves via `setSendingPolicy` against the *returned* version so
 * the two mutations compose atomically-in-sequence. CONFLICT reloads.
 */
export function WorkspaceStep({
  workspace,
  onDone,
}: {
  workspace: Doc<"workspaces">
  onDone: () => void
}) {
  const updateWorkspace = useMutation(api.workspaces.mutations.update)
  const setSendingPolicy = useMutation(api.workspaces.mutations.setSendingPolicy)

  const [detectedTimezone] = useState(detectLocalTimezone)
  const [form, setForm] = useState<WorkspacePolicyForm>(() =>
    workspaceToForm(workspace, detectedTimezone),
  )
  const [syncedAt, setSyncedAt] = useState(workspace.updatedAt)
  // Optimistic-concurrency base must be the version the edit STARTED from —
  // reading the live prop at submit would pass a version the user never saw.
  const [baseVersion, setBaseVersion] = useState(workspace.policyVersion)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync on `updatedAt`: a name-only edit does not bump `policyVersion`, but
  // the form must still follow the authoritative record.
  if (workspace.updatedAt !== syncedAt && !dirty) {
    setSyncedAt(workspace.updatedAt)
    setBaseVersion(workspace.policyVersion)
    setForm(workspaceToForm(workspace, detectedTimezone))
  }

  const update = (patch: Partial<WorkspacePolicyForm>) => {
    setDirty(true)
    setForm({ ...form, ...patch })
  }

  const validate = (): string | null => {
    if (form.name.trim() === "") {
      return "Workspace name is required."
    }
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
      const startMinute = timeStringToMinutes(form.startTime) ?? 0
      const endMinute = timeStringToMinutes(form.endTime) ?? 0
      const dailySendLimit = Number(form.dailySendLimit)

      let current = workspace
      const nameChanged = form.name.trim() !== workspace.name
      const timezoneChanged = form.timezone !== workspace.timezone
      if (nameChanged || timezoneChanged) {
        current = await updateWorkspace({
          workspaceId: workspace._id,
          name: form.name,
          timezone: form.timezone,
          expectedPolicyVersion: baseVersion,
        })
      }

      const windowChanged =
        form.weekdays.length !== workspace.sendWindow.weekdays.length ||
        form.weekdays.some(
          (day, index) => day !== workspace.sendWindow.weekdays[index],
        ) ||
        startMinute !== workspace.sendWindow.startMinute ||
        endMinute !== workspace.sendWindow.endMinute
      const limitChanged = dailySendLimit !== workspace.dailySendLimit
      if (windowChanged || limitChanged) {
        await setSendingPolicy({
          workspaceId: workspace._id,
          expectedPolicyVersion:
            nameChanged || timezoneChanged
              ? current.policyVersion
              : baseVersion,
          dailySendLimit,
          sendWindow: {
            weekdays: form.weekdays,
            startMinute,
            endMinute,
          },
        })
      }

      setDirty(false)
      toast.add({ title: "Workspace settings saved", type: "success" })
      onDone()
    } catch (cause) {
      if (isConflictError(cause)) {
        setDirty(false)
        setError(
          "Workspace policy changed in another session. The latest values were loaded — review them and save again.",
        )
      } else {
        setError(errorMessage(cause, "Could not save workspace settings."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace and send policy</CardTitle>
        <CardDescription>
          The timezone drives the sending window and the daily-limit boundary.
          Changing it bumps the workspace policy version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
            <Input
              id="ws-name"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ws-timezone">Timezone</FieldLabel>
            <NativeSelect
              id="ws-timezone"
              value={form.timezone}
              onChange={(event) => update({ timezone: event.target.value })}
            >
              {timezoneOptions(form.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription>
              Detected {detectedTimezone}. IANA name, validated server-side.
            </FieldDescription>
          </Field>
          <SendPolicyFields
            values={form}
            onChange={(next) => {
              setDirty(true)
              setForm({ ...form, ...next })
            }}
          />
          <FormError message={error} />
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Save and continue
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
