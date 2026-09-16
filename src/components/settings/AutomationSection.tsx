import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

/**
 * Pause/resume workspace automation (owner-only, `setAutomationState`).
 * `pauseReason: "onboarding_pending"` is not a manual pause — it points the
 * owner back to onboarding instead of offering a bare resume.
 */
export function AutomationSection({
  workspace,
  isOwner,
}: {
  workspace: Doc<"workspaces">
  isOwner: boolean
}) {
  const setAutomationState = useMutation(api.workspaces.setAutomationState)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const paused = workspace.automationState === "paused"
  const onboardingPending = paused && workspace.pauseReason === "onboarding_pending"

  const setState = async (state: "active" | "paused") => {
    setSaving(true)
    setError(null)
    try {
      await setAutomationState({ workspaceId: workspace._id, state })
      toast.add({
        title: state === "active" ? "Automation resumed" : "Automation paused",
        type: "success",
      })
    } catch (cause) {
      setError(errorMessage(cause, "Could not change automation state."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automation</CardTitle>
        <CardDescription>
          {paused
            ? "Automation is paused — employees will not start work."
            : "Automation is active — employees may run within policy."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={
              paused
                ? "size-2 rounded-full bg-muted-foreground"
                : "size-2 rounded-full bg-chart-2"
            }
          />
          <span className="font-medium">
            {paused ? "Paused" : "Active"}
          </span>
          {paused && workspace.pauseReason !== undefined ? (
            <span className="text-muted-foreground">
              — {workspace.pauseReason.replaceAll("_", " ")}
            </span>
          ) : null}
        </div>
        {onboardingPending ? (
          <p className="text-sm text-muted-foreground">
            Paused until onboarding is confirmed. Finish setup to activate.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Pausing stops new work from dispatching — it cannot recall mail
          already handed to the provider.
        </p>
        <FormError message={error} />
        {isOwner ? (
          <div>
            {onboardingPending ? (
              <Button
                variant="secondary"
                size="sm"
                render={<Link to="/onboarding" />}
              >
                Finish setup
              </Button>
            ) : paused ? (
              <Button
                size="sm"
                onClick={() => void setState("active")}
                disabled={saving}
              >
                {saving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <HugeiconsIcon
                    icon={PlayIcon}
                    data-icon="inline-start"
                    strokeWidth={2}
                  />
                )}
                Resume automation
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void setState("paused")}
                disabled={saving}
              >
                {saving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <HugeiconsIcon
                    icon={PauseIcon}
                    data-icon="inline-start"
                    strokeWidth={2}
                  />
                )}
                Pause automation
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only the workspace owner can pause or resume automation.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
