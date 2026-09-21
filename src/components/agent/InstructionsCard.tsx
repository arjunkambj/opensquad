/** Save explicitly: each revision invalidates existing drafts. Empty instructions use the org default. */
import { useMutation } from "convex/react"
import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { AGENT_INSTRUCTIONS_MAX_LENGTH } from "../../../convex/lib/validators"
import { api } from "../../../convex/_generated/api"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { agentErrorCopy } from "./agent-model"
import type { AgentDoc } from "./agent-model"

export function InstructionsCard({ agent }: { agent: AgentDoc }) {
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
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not save the instructions."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instructions</CardTitle>
        <CardDescription>
          What this agent should say and avoid. Saving replaces any email it
          has written but not sent, so the next one follows the new wording.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
            Leave this empty to use the organization default from{" "}
            <Link to="/settings" search={{ tab: "outreach" }}>
              Settings → Outreach
            </Link>
            . Anything written here overrides it for this agent.
          </FieldDescription>
        </Field>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? <Spinner data-icon="inline-start" /> : null}
            Save instructions
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
