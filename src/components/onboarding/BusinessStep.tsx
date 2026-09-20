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
 * Step 1 — the company profile everything downstream is written from
 * (PLAN §7). Persists immediately via `businessProfiles.update` with
 * `expectedVersion` optimistic concurrency (0 = create); CONFLICT reloads the
 * authoritative record.
 *
 * Typed by hand here. Filling it from a real website analysis, with the
 * loading and failure states of PLAN §5, is T20's.
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
  const updateProfile = useMutation(api.company.mutations.update)

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
        ...(form.websiteUrl.trim() === ""
          ? {}
          : { websiteUrl: form.websiteUrl }),
        companyName: form.companyName,
        industry: form.industry,
        description: form.description,
        keyFeatures: splitListInput(form.keyFeaturesText),
        socialProof: splitListInput(form.socialProofText),
        painPoints: form.painPoints,
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
        <CardTitle>Your company</CardTitle>
        <CardDescription>
          The agent researches leads and writes every email from this profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="bp-website">Company website</FieldLabel>
            <Input
              id="bp-website"
              type="url"
              placeholder="https://example.com"
              value={form.websiteUrl}
              onChange={(event) => update({ websiteUrl: event.target.value })}
            />
            <FieldDescription>
              A public http(s) URL. Leave it empty if you do not have one.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-company">Company name</FieldLabel>
            <Input
              id="bp-company"
              value={form.companyName}
              onChange={(event) => update({ companyName: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-industry">Industry</FieldLabel>
            <Input
              id="bp-industry"
              value={form.industry}
              onChange={(event) => update({ industry: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-description">
              What does your company do?
            </FieldLabel>
            <Textarea
              id="bp-description"
              value={form.description}
              onChange={(event) => update({ description: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-features">Key features</FieldLabel>
            <Textarea
              id="bp-features"
              value={form.keyFeaturesText}
              onChange={(event) =>
                update({ keyFeaturesText: event.target.value })
              }
            />
            <FieldDescription>
              One per line. These are what the outreach may claim.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-proof">Social proof</FieldLabel>
            <Textarea
              id="bp-proof"
              value={form.socialProofText}
              onChange={(event) =>
                update({ socialProofText: event.target.value })
              }
            />
            <FieldDescription>
              One per line — customers, results or numbers you can stand behind.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="bp-pain">Pain points you solve</FieldLabel>
            <Textarea
              id="bp-pain"
              value={form.painPoints}
              onChange={(event) => update({ painPoints: event.target.value })}
            />
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
