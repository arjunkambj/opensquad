/** SettingsPage only mounts this card after the agent has finished onboarding. */
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { PageSection } from "@/components/kit/PageSection"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { errorMessage } from "@/lib/convex-error"
import type { OrgView } from "@/lib/org-view"

export function AutomationCard({ org }: { org: OrgView }) {
  const setAutomationState = useMutation(
    api.orgs.mutations.setAutomationState,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paused = org.automationState === "paused"

  const setState = (state: "active" | "paused") => {
    setSaving(true)
    setError(null)
    void setAutomationState({ orgId: org._id, state })
      .then(() =>
        toast.add({
          title: state === "active" ? "Automation resumed" : "Automation paused",
          description:
            state === "active"
              ? "Your agent picks up its next run inside the sending window."
              : "Your agent starts nothing new until you resume it.",
          type: "success",
        }),
      )
      .catch((cause) =>
        setError(errorMessage(cause, "Could not change the automation state.")),
      )
      .finally(() => setSaving(false))
  }

  return (
    <PageSection
      title="Automation"
      description="Pausing stops all new work. Mail already sent can't be recalled."
    >
      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            paused ? "bg-muted-foreground" : "bg-chart-2",
          )}
        />
        <span className="font-medium text-foreground">
          {paused ? "Paused" : "Active"}
        </span>
      </div>

      <FormError message={error} />

      <div>
        <Button
          disabled={saving}
          onClick={() => setState(paused ? "active" : "paused")}
          size="sm"
          type="button"
          variant={paused ? "default" : "secondary"}
        >
          {saving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HugeiconsIcon
              aria-hidden="true"
              data-icon="inline-start"
              icon={paused ? PlayIcon : PauseIcon}
              strokeWidth={2}
            />
          )}
          {paused ? "Resume automation" : "Pause automation"}
        </Button>
      </div>
    </PageSection>
  )
}
