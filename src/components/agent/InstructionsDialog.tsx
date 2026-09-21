/** Save explicitly: each revision invalidates existing drafts. Empty instructions use the org default. */
import { QuillWrite02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { AGENT_INSTRUCTIONS_MAX_LENGTH } from "../../../convex/lib/validators"
import { api } from "../../../convex/_generated/api"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { agentErrorCopy } from "./agent-model"
import type { AgentDoc } from "./agent-model"

export function InstructionsDialog({ agent }: { agent: AgentDoc }) {
  const [open, setOpen] = useState(false)
  const setInstructions = useMutation(api.agents.settings.setInstructions)
  const stored = agent.instructions ?? ""
  const [draft, setDraft] = useState(stored)
  const [syncedWith, setSyncedWith] = useState(stored)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A change saved in another session replaces an untouched field; a field the
  // user is editing is left alone.
  if (stored !== syncedWith && draft === syncedWith) {
    setSyncedWith(stored)
    setDraft(stored)
  }

  const dirty = draft !== stored

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await setInstructions({
        orgId: agent.orgId,
        agentId: agent._id,
        instructions: draft,
      })
      // The backend stores the trimmed text, so the field shows what was
      // actually saved rather than staying dirty over a trailing space.
      const saved = draft.trim()
      setDraft(saved)
      setSyncedWith(saved)
      toast.add({ title: "Instructions saved", type: "success" })
      setOpen(false)
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not save the instructions."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          // Reopening starts from what is saved: an edit abandoned with Cancel
          // must not come back looking like unsaved work.
          setDraft(stored)
          setSyncedWith(stored)
          setError(null)
          setOpen(true)
        }}
      >
        <HugeiconsIcon
          icon={QuillWrite02Icon}
          strokeWidth={2}
          data-icon="inline-start"
          aria-hidden="true"
        />
        Instructions
      </Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
      <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Instructions</DialogTitle>
        <DialogDescription>
          What your agent should say and avoid.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <Field>
          <Textarea
            id="agent-instructions"
            aria-label="Agent instructions"
            rows={6}
            maxLength={AGENT_INSTRUCTIONS_MAX_LENGTH}
            disabled={saving}
            value={draft}
            placeholder="Mention that we integrate with their CRM. Never promise a discount."
            onChange={(event) => setDraft(event.target.value)}
          />
          <FieldDescription>
            Empty uses your{" "}
            <Link to="/settings" search={{ tab: "outreach" }}>
              default instructions
            </Link>
            .
          </FieldDescription>
        </Field>
        <FormError message={error} />
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" disabled={saving} />}>
          Cancel
        </DialogClose>
        <Button disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </DialogFooter>
      </DialogContent>
      </Dialog>
    </>
  )
}
