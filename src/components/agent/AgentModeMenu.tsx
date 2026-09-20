/**
 * The mode badge and its dropdown (reference 21), and the one control that
 * can ask for Autopilot.
 *
 * Every mode carries its one-line explanation in the menu, because "Review"
 * and "Autopilot" are not self-explanatory and the difference between them is
 * whether mail leaves without the user. Choosing Autopilot opens the consent
 * dialog rather than switching: the switch only happens from the dialog's
 * Accept, and the backend refuses it without the payload that Accept sends.
 */
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import { AGENT_MODES } from "../../../convex/lib/validators"
import type { AgentMode } from "../../../convex/lib/validators"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import { AutopilotConsentDialog } from "./AutopilotConsentDialog"
import type { AgentDoc } from "./agent-model"
import {
  agentErrorCopy,
  MODE_DESCRIPTION,
  MODE_LABEL,
  MODE_REFUSAL_COPY,
} from "./agent-model"

export function AgentModeMenu({
  agent,
  dailySendLimit,
}: {
  agent: AgentDoc
  dailySendLimit: number
}) {
  const setMode = useMutation(api.agents.settingsMode.setMode)
  const [consentOpen, setConsentOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consentError, setConsentError] = useState<string | null>(null)

  const apply = async (mode: AgentMode, withConsent: boolean) => {
    setSaving(true)
    setError(null)
    setConsentError(null)
    try {
      const result = await setMode({
        orgId: agent.orgId,
        agentId: agent._id,
        mode,
        // The revision the dialog quoted the caps under: the backend refuses
        // a consent given for a different version of the agent.
        ...(withConsent
          ? {
              autopilotConsent: {
                revision: agent.revision,
                accepted: true as const,
              },
            }
          : {}),
      })
      if (!result.ok) {
        const copy = MODE_REFUSAL_COPY[result.reason]
        if (withConsent) setConsentError(copy)
        else setError(copy)
        return
      }
      setConsentOpen(false)
      toast.add({ title: `Mode set to ${MODE_LABEL[mode]}`, type: "success" })
    } catch (cause) {
      const copy = agentErrorCopy(cause, "Could not change the mode.")
      if (withConsent) setConsentError(copy)
      else setError(copy)
    } finally {
      setSaving(false)
    }
  }

  const choose = (mode: AgentMode) => {
    if (mode === agent.mode) {
      return
    }
    if (mode === "autopilot") {
      setConsentError(null)
      setConsentOpen(true)
      return
    }
    void apply(mode, false)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={saving}
          render={<Button variant="outline" size="sm" />}
        >
          {MODE_LABEL[agent.mode]}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            data-icon="inline-end"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {AGENT_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              onClick={() => choose(mode)}
              className="flex-col items-start gap-0.5"
            >
              <span className="font-medium text-foreground">
                {MODE_LABEL[mode]}
                {mode === agent.mode ? " · current" : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {MODE_DESCRIPTION[mode]}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <FormError message={error} />
      <AutopilotConsentDialog
        agent={agent}
        dailySendLimit={dailySendLimit}
        open={consentOpen}
        saving={saving}
        error={consentError}
        onOpenChange={(open) => {
          setConsentOpen(open)
          if (!open) setConsentError(null)
        }}
        onAccept={() => void apply("autopilot", true)}
      />
    </div>
  )
}
