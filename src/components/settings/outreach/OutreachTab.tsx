/**
 * Settings → Outreach (reference 26, PLAN §1).
 *
 * One default-instructions field, not a template library: the reference's
 * "Outreach Templates" section header with its primary action, and its
 * illustrated empty state, saying what the agent writes when nothing is set.
 *
 * The container owns the read and the write. Editing is a mode rather than a
 * separate screen, so an org with no default shows the empty state until
 * someone asks to write one.
 */
import { MagicWand01Icon, Note01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { EmptyState } from "@/components/kit/EmptyState"
import { InstructionsEditorCard } from "@/components/settings/outreach/InstructionsEditorCard"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
      <LoadingState
        title="Loading your outreach instructions"
        description="Reading the default your agent writes from."
      />
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
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionHeaderCard
        icon={MagicWand01Icon}
        title="Outreach instructions"
        description="How your agent writes when it has no instructions of its own. An agent with its own takes precedence."
        action={
          !editing && stored.instructions !== null ? (
            <Button
              onClick={() => setEditing(true)}
              type="button"
              variant="outline"
            >
              Edit instructions
            </Button>
          ) : undefined
        }
      />

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
        <Card>
          <CardContent>
            <EmptyState
              icon={Note01Icon}
              title="No default instructions yet"
              description="Without them your agent writes from your company profile and what it researched about the lead: the problem it thinks they have, one relevant thing you do, and a short ask. Add instructions to set the voice, the length and what it must never claim."
              action={
                <Button onClick={() => setEditing(true)} type="button">
                  <HugeiconsIcon
                    aria-hidden="true"
                    data-icon="inline-start"
                    icon={MagicWand01Icon}
                    strokeWidth={2}
                  />
                  Write default instructions
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm whitespace-pre-wrap text-foreground">
              {stored.instructions}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
