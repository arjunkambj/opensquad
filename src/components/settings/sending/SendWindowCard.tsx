/**
 * Settings → Sending, the window card: when the agent may send, and how much.
 *
 * It owns its own two mutations because the record has two owners: the
 * timezone belongs to the org record and the window and limit to the
 * sending policy, and both bump `policyVersion`. So a save that changes both
 * writes the timezone FIRST and then uses the version that write returned —
 * sending the version the form started from to the second call would be a
 * guaranteed CONFLICT against a change the same user just made.
 *
 * `expectedPolicyVersion` is the version the edit STARTED from, so a change
 * made in another session is refused rather than silently overwritten. A bump
 * invalidates approvals written against the old policy, which is why a save
 * that changes nothing must not happen — the server skips the write, and this
 * form disables Save until something is dirty.
 */
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import { TRIAL_DAILY_SEND_LIMIT_MAX } from "../../../../convex/lib/limits"
import { SendWindowFields } from "@/components/settings/sending/SendWindowFields"
import type { SendWindowValues } from "@/components/settings/sending/SendWindowFields"
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
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import {
  minutesToTimeString,
  timeStringToMinutes,
} from "@/lib/org-time"
import type { OrgView } from "@/lib/org-view"

function valuesOf(org: OrgView): SendWindowValues {
  return {
    timezone: org.timezone,
    weekdays: [...org.sendWindow.weekdays],
    startTime: minutesToTimeString(org.sendWindow.startMinute),
    endTime: minutesToTimeString(org.sendWindow.endMinute),
    dailySendLimit: String(org.dailySendLimit),
  }
}

export function SendWindowCard({ org }: { org: OrgView }) {
  const updateOrg = useMutation(api.orgs.mutations.update)
  const setSendingPolicy = useMutation(api.orgs.mutations.setSendingPolicy)

  const [form, setForm] = useState<SendWindowValues>(valuesOf(org))
  const [syncedAt, setSyncedAt] = useState(org.updatedAt)
  const [baseVersion, setBaseVersion] = useState(org.policyVersion)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resync on `updatedAt` rather than `policyVersion`: a change elsewhere on
  // the record moves one and not always the other.
  if (org.updatedAt !== syncedAt && !dirty) {
    setSyncedAt(org.updatedAt)
    setBaseVersion(org.policyVersion)
    setForm(valuesOf(org))
  }

  const validate = (): string | null => {
    if (form.weekdays.length === 0) {
      return "Pick at least one sending day."
    }
    const start = timeStringToMinutes(form.startTime)
    const end = timeStringToMinutes(form.endTime)
    if (start === undefined || end === undefined) {
      return "The sending window needs valid times."
    }
    if (start >= end) {
      return "The window has to open before it closes."
    }
    const limit = Number(form.dailySendLimit)
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > TRIAL_DAILY_SEND_LIMIT_MAX
    ) {
      return `The daily send limit is a whole number between 1 and ${TRIAL_DAILY_SEND_LIMIT_MAX}.`
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
      let version = baseVersion
      if (form.timezone !== org.timezone) {
        const updated = await updateOrg({
          orgId: org._id,
          timezone: form.timezone,
          expectedPolicyVersion: version,
        })
        version = updated.policyVersion
      }
      await setSendingPolicy({
        orgId: org._id,
        expectedPolicyVersion: version,
        dailySendLimit: Number(form.dailySendLimit),
        sendWindow: {
          weekdays: form.weekdays,
          startMinute: timeStringToMinutes(form.startTime) ?? 0,
          endMinute: timeStringToMinutes(form.endTime) ?? 0,
        },
      })
      setDirty(false)
      toast.add({
        title: "Sending policy saved",
        description:
          "Drafts already approved under the previous policy need approving again.",
        type: "success",
      })
    } catch (cause) {
      if (isConflictError(cause)) {
        setDirty(false)
        setError(
          "This policy changed in another session. The current values are shown — check them and save again.",
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
        <CardTitle>Sending window</CardTitle>
        <CardDescription>
          Saving this invalidates approvals written against the old policy, so
          a draft waiting to go out needs approving again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <SendWindowFields
          disabled={saving}
          values={form}
          onChange={(next) => {
            setDirty(true)
            setForm(next)
          }}
        />
        <FormError message={error} />
        <div className="flex justify-end">
          <Button
            disabled={!dirty || saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? <Spinner data-icon="inline-start" /> : null}
            Save sending policy
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
