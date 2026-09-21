/** Save timezone first and use its returned policyVersion for the sending-policy write.
 * If the second write fails, retain the draft and new version so retry can finish the partial save. */
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import { TRIAL_DAILY_SEND_LIMIT_MAX } from "../../../../convex/lib/prices"
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
    // Whether the timezone half of the save already committed. Once it has,
    // the record has moved and this form is the only place the other half
    // still exists, so a failure after it must neither claim success nor
    // throw the unsaved window away.
    let timezoneApplied = false
    try {
      let version = baseVersion
      if (form.timezone !== org.timezone) {
        const updated = await updateOrg({
          orgId: org._id,
          timezone: form.timezone,
          expectedPolicyVersion: version,
        })
        version = updated.policyVersion
        timezoneApplied = true
        // Adopt the version that write landed on straight away. Pressing Save
        // again has to be checked against what the record IS: re-sending the
        // version the form started from would conflict on every retry, and
        // the user would never be able to finish their own save.
        setBaseVersion(version)
      }
      const saved = await setSendingPolicy({
        orgId: org._id,
        expectedPolicyVersion: version,
        dailySendLimit: Number(form.dailySendLimit),
        sendWindow: {
          weekdays: form.weekdays,
          startMinute: timeStringToMinutes(form.startTime) ?? 0,
          endMinute: timeStringToMinutes(form.endTime) ?? 0,
        },
      })
      setBaseVersion(saved.policyVersion)
      setDirty(false)
      toast.add({
        title: "Sending policy saved",
        description:
          "Drafts already approved under the previous policy need approving again.",
        type: "success",
      })
    } catch (cause) {
      if (timezoneApplied) {
        // Keep the unsaved half dirty and retry against the version returned by the committed write.
        setError(
          "Your time zone was saved, but the sending window and daily limit were not. They are still as you left them — press Save to finish.",
        )
      } else if (isConflictError(cause)) {
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
