/** onboarding_pending requires finishing setup, not manually resuming automation. */
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
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
  const onboardingPending =
    paused && org.pauseReason === "onboarding_pending"

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
    <Card>
      <CardHeader>
        <CardTitle>Automation</CardTitle>
        <CardDescription>
          The one switch that stops your agent starting work — sourcing,
          research, writing and sending alike.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
          <span className="text-muted-foreground">
            {paused
              ? "— nothing new is started."
              : "— your agent may run inside the window above."}
          </span>
        </div>

        {onboardingPending ? (
          <p className="text-sm text-muted-foreground">
            Paused until setup is confirmed, rather than by anyone&rsquo;s
            choice. Finish setup and it activates itself.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pausing stops new work from dispatching. It cannot recall mail
            already handed to the provider, and it leaves leads, drafts and
            conversations exactly as they are.
          </p>
        )}

        <FormError message={error} />

        <div>
          {onboardingPending ? (
            <Button
              render={<Link to="/onboarding" />}
              size="sm"
              variant="secondary"
            >
              Finish setup
            </Button>
          ) : (
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
          )}
        </div>
      </CardContent>
    </Card>
  )
}
