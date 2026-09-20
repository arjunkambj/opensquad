/**
 * The agent card (reference 21): the name, the mode, the funnel, and a footer
 * naming the inbox it sends from and the day it was created.
 *
 * The reference's "Open" button is absent — this page IS the agent, so there
 * is nowhere for it to lead — and so is its "n / m running agents" counter: a
 * workspace runs exactly one agent (PLAN §2).
 */
import { MoreHorizontalCircle01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { WorkspaceView } from "@/lib/workspace-view"
import { AgentFunnelRow } from "./AgentFunnelRow"
import { AgentModeMenu } from "./AgentModeMenu"
import { AgentNameField } from "./AgentNameField"
import { agentErrorCopy, formatDay } from "./agent-model"
import type { AgentDoc, AgentFunnel } from "./agent-model"

export function AgentCard({
  agent,
  workspace,
  funnel,
  canEdit,
}: {
  agent: AgentDoc
  workspace: WorkspaceView
  funnel: AgentFunnel | undefined
  canEdit: boolean
}) {
  const rename = useMutation(api.agents.settings.rename)
  const setMode = useMutation(api.agents.settingsMode.setMode)
  const [editingName, setEditingName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (name: string) => {
    setSaving(true)
    setError(null)
    try {
      await rename({ workspaceId: agent.workspaceId, agentId: agent._id, name })
      setEditingName(false)
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not rename the agent."))
    } finally {
      setSaving(false)
    }
  }

  const pause = async () => {
    setError(null)
    try {
      // Pausing needs no consent and can never be refused for a missing
      // inbox, so the typed refusal is only surfaced defensively.
      const result = await setMode({
        workspaceId: agent.workspaceId,
        agentId: agent._id,
        mode: "paused",
      })
      if (!result.ok) {
        setError("Could not pause the agent.")
      }
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not pause the agent."))
    }
  }

  // PLAN §9.3: an instruction change keeps Autopilot on and is RECORDED. The
  // record is the authorisation sitting on an older revision, so say so.
  const consentOutdated =
    agent.mode === "autopilot" &&
    agent.autopilot !== undefined &&
    agent.autopilot.revision !== agent.revision

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <AgentNameField
            name={agent.name}
            canEdit={canEdit}
            editing={editingName}
            saving={saving}
            onStartEditing={() => setEditingName(true)}
            onCancel={() => setEditingName(false)}
            onSave={(name) => void save(name)}
          />
          <AgentModeMenu
            agent={agent}
            dailySendLimit={workspace.dailySendLimit}
            canEdit={canEdit}
          />
        </div>
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Agent actions"
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <HugeiconsIcon
                icon={MoreHorizontalCircle01Icon}
                strokeWidth={2}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setEditingName(true)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={agent.mode === "paused"}
                onClick={() => void pause()}
              >
                Pause
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <AgentFunnelRow funnel={funnel} />
        {consentOutdated ? (
          <p className="text-xs text-muted-foreground">
            Your instructions changed after you authorised Autopilot. It is
            still on, and it is now working from the new wording.
          </p>
        ) : null}
        <FormError message={error} />
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
        <span>
          {workspace.inboxRef === undefined
            ? "No sending inbox connected"
            : `Sends from ${workspace.inboxRef}`}
        </span>
        <span>Created {formatDay(agent.createdAt, workspace.timezone)}</span>
      </CardFooter>
    </Card>
  )
}
