import { MagicWand01Icon, Note01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { EmptyState } from "@/components/states/states"
import { SkeletonRegion } from "@/components/states/skeletons"
import { InstructionsEditorCard } from "@/components/settings/outreach/InstructionsEditorCard"
import { PageSection } from "@/components/kit/PageSection"
import { OutreachTabSkeleton } from "@/components/settings/SettingsTabSkeletons"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

export function OutreachTab({ orgId }: { orgId: Id<"orgs"> }) {
  const stored = useQuery(api.orgs.outreachDefaults.get, { orgId })
  const save = useMutation(api.orgs.outreachDefaults.save)

  const [draft, setDraft] = useState("")
  const [syncedAt, setSyncedAt] = useState(-1)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Adopt the record whenever it changes underneath us, unless the editor is
  // open — a save from another session must not overwrite what is being typed.
  if (stored !== undefined && stored.updatedAt !== syncedAt && !editing) {
    setSyncedAt(stored.updatedAt)
    setDraft(stored.instructions ?? "")
  }

  if (stored === undefined) {
    return (
      <SkeletonRegion label="Loading your outreach instructions">
        <OutreachTabSkeleton />
      </SkeletonRegion>
    )
  }

  const submit = () => {
    setSaving(true)
    setError(null)
    void save({ orgId, instructions: draft })
      .then((result) => {
        setEditing(false)
        setSyncedAt(result.updatedAt)
        setDraft(result.instructions ?? "")
        toast.add({
          title:
            result.instructions === null
              ? "Default instructions cleared"
              : "Default instructions saved",
          description:
            result.instructions === null
              ? "Agents without their own instructions go back to writing from your company profile alone."
              : "Every agent without its own instructions writes from these.",
          type: "success",
        })
      })
      .catch((cause) => {
        setError(errorMessage(cause, "Could not save the instructions."))
      })
      .finally(() => setSaving(false))
  }

  return (
    <PageSection
      action={
        !editing && stored.instructions !== null ? (
          <Button onClick={() => setEditing(true)} type="button" variant="outline">
            Edit
          </Button>
        ) : undefined
      }
    >
      {editing ? (
        <InstructionsEditorCard
          dirty={draft.trim() !== (stored.instructions ?? "")}
          error={error}
          onCancel={() => {
            setEditing(false)
            setDraft(stored.instructions ?? "")
            setError(null)
          }}
          onChange={setDraft}
          onSave={submit}
          saving={saving}
          value={draft}
        />
      ) : stored.instructions === null ? (
        <EmptyState
          variant="plain"
          icon={Note01Icon}
          title="No default instructions yet"
          description="Set the voice, the length and what your agent must never claim."
          action={
            <Button onClick={() => setEditing(true)} type="button">
              <HugeiconsIcon
                aria-hidden="true"
                data-icon="inline-start"
                icon={MagicWand01Icon}
                strokeWidth={2}
              />
              Write instructions
            </Button>
          }
        />
      ) : (
        <p className="text-sm whitespace-pre-wrap text-foreground">
          {stored.instructions}
        </p>
      )}
    </PageSection>
  )
}
