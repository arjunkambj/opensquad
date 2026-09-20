/**
 * What the agent is told to say — the one instructions field that replaces
 * templates (PLAN §1).
 *
 * Saved explicitly, never on every keystroke: a change here bumps
 * `agents.revision`, which supersedes every draft written under the old
 * wording and has them rewritten on the next pass. That is not something to
 * do per character.
 *
 * Empty means the workspace default from Settings → Outreach applies, which
 * the card says rather than leaving the user to discover.
 */
import { useMutation } from "convex/react"
import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { AGENT_INSTRUCTIONS_MAX_LENGTH } from "../../../convex/lib/validators"
import { api } from "../../../convex/_generated/api"
import { FormError, PermissionNote } from "@/components/states/states"
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
import type { WorkspaceRole } from "@/lib/workspace-role"
import { canEdit as roleCanEdit } from "@/lib/workspace-role"
import { agentErrorCopy } from "./agent-model"
import type { AgentDoc } from "./agent-model"

export function InstructionsCard({
  agent,
  role,
}: {
  agent: AgentDoc
  role: WorkspaceRole
}) {
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

  const editable = roleCanEdit(role)
  const dirty = draft !== stored

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await setInstructions({
        workspaceId: agent.workspaceId,
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
            disabled={!editable || saving}
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
        {editable ? (
          <div className="flex justify-end">
            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              Save instructions
            </Button>
          </div>
        ) : (
          <PermissionNote role={role} action="change what the agent says" />
        )}
      </CardContent>
    </Card>
  )
}
