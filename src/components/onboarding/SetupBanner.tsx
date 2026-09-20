import { ArrowRight01Icon, RocketIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * Setup call-to-action shown on the dashboard while the workspace exists but
 * has not completed onboarding. Disappears once automation is activated — and
 * while workspace data is still loading it renders nothing rather than
 * flashing.
 *
 * It has no "no workspace yet" branch: `_workspace` redirects that case to
 * `/onboarding` before this renders.
 */
export function SetupBanner() {
  const current = useCurrentWorkspace()

  if (current === undefined || current === null) {
    return null
  }

  const { workspace } = current
  if (
    workspace.automationState === "paused" &&
    workspace.pauseReason === "onboarding_pending"
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={RocketIcon}
              strokeWidth={2}
              className="size-4"
              aria-hidden="true"
            />
            Finish workspace setup
          </CardTitle>
          <CardDescription>
            Automation is paused until you confirm your business profile,
            sending policy and agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link to="/onboarding" />} variant="secondary">
            Continue setup
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              data-icon="inline-end"
              strokeWidth={2}
            />
          </Button>
        </CardContent>
      </Card>
    )
  }

  return null
}
