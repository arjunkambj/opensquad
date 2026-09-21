/**
 * The agent card (reference 21): the name, the mode, its run state, and a footer
 * naming the inbox it sends from and the day it was created.
 *
 * The reference's "Open" button is absent — this page IS the agent, so there
 * is nowhere for it to lead — and so is its "n / m running agents" counter: a
 * org runs exactly one agent (PLAN §2).
 */
import { MoreHorizontalCircle01Icon, Robot01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState, type ReactNode } from "react"
import { api } from "../../../convex/_generated/api"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { FramedPanel } from "@/components/kit/FramedPanel"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { OrgView } from "@/lib/org-view"
import { AgentModeMenu } from "./AgentModeMenu"
import { AgentNameField } from "./AgentNameField"
import { agentErrorCopy, formatDay } from "./agent-model"
import type { AgentDoc } from "./agent-model"

export function AgentCard({
  agent,
  org,
  runPanel,
}: {
  agent: AgentDoc
  org: OrgView
  /** When it last ran, when it runs next, and the Run now control. */
  runPanel: ReactNode
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
      await rename({ orgId: agent.orgId, agentId: agent._id, name })
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
        orgId: agent.orgId,
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
    <FramedPanel
      title="Agent"
      icon={Robot01Icon}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Agent actions"
            render={<Button variant="ghost" size="icon-xs" />}
          >
            <HugeiconsIcon icon={MoreHorizontalCircle01Icon} strokeWidth={2} />
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
      }
      bodyClassName="gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <AgentNameField
            name={agent.name}
            editing={editingName}
            saving={saving}
            onStartEditing={() => setEditingName(true)}
            onCancel={() => setEditingName(false)}
            onSave={(name) => void save(name)}
          />
          <p className="truncate text-xs text-muted-foreground">
            {org.inboxRef === undefined
              ? "No inbox connected"
              : `Sends from ${org.inboxRef}`}
            {" · "}Created {formatDay(agent.createdAt, org.timezone)}
          </p>
        </div>
        <AgentModeMenu agent={agent} dailySendLimit={org.dailySendLimit} />
      </div>

      {runPanel}

      {consentOutdated ? (
        <p className="text-xs text-muted-foreground">
          Your instructions changed after you turned on Autopilot. It is now
          working from the new wording.
        </p>
      ) : null}
      <FormError message={error} />
    </FramedPanel>
  )
}
