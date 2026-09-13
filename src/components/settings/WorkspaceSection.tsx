import { useMutation } from "convex/react"
import { useState } from "react"
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
import { timezoneOptions } from "@/lib/workspace-time"

/**
 * Workspace name and timezone (owner-only). A real timezone change requires
 * the current `expectedPolicyVersion` and bumps `policyVersion`; name-only
 * edits preserve it. CONFLICT reloads the authoritative record.
 */
export function WorkspaceSection({
  workspace,
  isOwner,
}: {
  workspace: Doc<"workspaces">
  isOwner: boolean
}) {
  const updateWorkspace = useMutation(api.workspaces.update)

  const [form, setForm] = useState({
    name: workspace.name,
    timezone: workspace.timezone,
  })
  const [syncedAt, setSyncedAt] = useState(workspace.updatedAt)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync on `updatedAt`: name-only edits do not bump `policyVersion`.
  if (workspace.updatedAt !== syncedAt && !dirty) {
    setSyncedAt(workspace.updatedAt)
    setForm({ name: workspace.name, timezone: workspace.timezone })
  }

  const update = (patch: Partial<typeof form>) => {
    setDirty(true)
    setForm({ ...form, ...patch })
  }

  const save = async () => {
    if (form.name.trim() === "") {
      setError("Workspace name is required.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateWorkspace({
        workspaceId: workspace._id,
        name: form.name,
        timezone: form.timezone,
        expectedPolicyVersion: workspace.policyVersion,
      })
      setDirty(false)
      toast.add({ title: "Workspace saved", type: "success" })
    } catch (cause) {
      if (isConflictError(cause)) {
        setDirty(false)
        setError(
          "Workspace policy changed in another session. The latest values were loaded — review them and save again.",
        )
      } else {
        setError(errorMessage(cause, "Could not save the workspace."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          Name and IANA timezone. The timezone drives the sending window and
          daily-limit boundary — changing it bumps the policy version.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="settings-ws-name">Name</FieldLabel>
            <Input
              id="settings-ws-name"
              readOnly={!isOwner}
              disabled={!isOwner}
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-ws-timezone">Timezone</FieldLabel>
            <NativeSelect
              id="settings-ws-timezone"
              disabled={!isOwner}
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
              Current policy version: v{workspace.policyVersion}
            </FieldDescription>
          </Field>
          <FormError message={error} />
          {isOwner ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                {saving ? <Spinner data-icon="inline-start" /> : null}
                Save workspace
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only the workspace owner can change these settings.
            </p>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
