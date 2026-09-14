import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { FormError } from "@/components/states/states"
import {
  type BusinessProfileForm,
  profileToForm,
  splitListInput,
} from "@/components/onboarding/onboarding-model"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage, isConflictError } from "@/lib/convex-error"

/**
 * Step 1 — business profile. Persists immediately via
 * `businessProfiles.update` with `expectedVersion` optimistic concurrency
 * (0 = create). CONFLICT reloads the authoritative record.
 */
export function BusinessStep({
  workspaceId,
  profile,
  onDone,
}: {
  workspaceId: Id<"workspaces">
  profile: Doc<"businessProfiles"> | null
  onDone: () => void
}) {
  const updateProfile = useMutation(api.businessProfiles.update)

  const [form, setForm] = useState<BusinessProfileForm>(() =>
    profileToForm(profile),
  )
  const [syncedAt, setSyncedAt] = useState(profile?.updatedAt ?? 0)
  // Optimistic-concurrency base must be the version the edit STARTED from —
  // reading the live prop at submit would pass a version the user never saw.
  const [baseVersion, setBaseVersion] = useState(profile?.version ?? 0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resync when the authoritative record changes underneath us (e.g. after a
  // CONFLICT the reactive query delivers the newer record) while no local
  // edit is in flight. `updatedAt` bumps on every write; `version` doesn't.
  const docUpdatedAt = profile?.updatedAt ?? 0
  if (docUpdatedAt !== syncedAt && !dirty) {
    setSyncedAt(docUpdatedAt)
    setBaseVersion(profile?.version ?? 0)
    setForm(profileToForm(profile))
  }

  const update = (patch: Partial<BusinessProfileForm>) => {
    setDirty(true)
    setForm({ ...form, ...patch })
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateProfile({
        workspaceId,
        expectedVersion: baseVersion,
        websiteUrl: form.websiteUrl,
        offer: form.offer,
        idealCustomer: form.idealCustomer,
        tone: form.tone,
        exclusions: splitListInput(form.exclusionsText),
      })
      setDirty(false)
      toast.add({ title: "Business profile saved", type: "success" })
      onDone()
    } catch (cause) {
      if (isConflictError(cause)) {
        setDirty(false)
        setError(
          "This profile changed in another session. The latest values were loaded — review them and save again.",
        )
      } else {
        setError(errorMessage(cause, "Could not save the business profile."))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your business</CardTitle>
        <CardDescription>
          Scout, Researcher and Outreach write and research from this profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="bp-website">Business website</FieldLabel>
            <Input
              id="bp-website"
              type="url"
              placeholder="https://example.com"
              value={form.websiteUrl}
              onChange={(event) => update({ websiteUrl: event.target.value })}
            />
            <FieldDescription>
              A public http(s) URL employees can research.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-offer">What do you offer?</FieldLabel>
            <Textarea
              id="bp-offer"
              placeholder="e.g. Done-for-you outbound engine for B2B agencies"
              value={form.offer}
              onChange={(event) => update({ offer: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-icp">Ideal customer</FieldLabel>
            <Textarea
              id="bp-icp"
              placeholder="e.g. US-based marketing agencies with 5–50 employees"
              value={form.idealCustomer}
              onChange={(event) =>
                update({ idealCustomer: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-tone">Tone</FieldLabel>
            <Input
              id="bp-tone"
              placeholder="e.g. Direct, friendly, no buzzwords"
              value={form.tone}
              onChange={(event) => update({ tone: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-exclusions">Exclusions</FieldLabel>
            <Textarea
              id="bp-exclusions"
              placeholder={"One per line — companies, domains or segments to never contact"}
              value={form.exclusionsText}
              onChange={(event) =>
                update({ exclusionsText: event.target.value })
              }
            />
            <FieldDescription>
              One entry per line. Employees must never target these.
            </FieldDescription>
          </Field>
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
