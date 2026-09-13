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
 * Setup call-to-action shown on the dashboard while the workspace has not
 * completed onboarding. Disappears once automation is activated — and while
 * workspace data is still loading it renders nothing rather than flashing.
 */
export function SetupBanner() {
  const current = useCurrentWorkspace()

  if (current === undefined) {
    return null
  }

  if (current === null) {
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
            Set up your workspace
          </CardTitle>
          <CardDescription>
            Create your workspace and its three AI employees — Scout,
            Researcher and Outreach — then tell them who to sell to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link to="/onboarding" />}>
            Start setup
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
            sending policy and campaign scope.
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
