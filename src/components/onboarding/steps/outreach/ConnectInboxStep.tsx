/** Connecting or skipping an inbox keeps the agent in sourcing_only.
 * Review and Autopilot require an explicit mode change on the Autopilot page. */
import { Hint } from "@/components/kit/Hint"
import { InboxConnection } from "@/components/inbox-connection/InboxConnection"
import { useInboxConnection } from "@/components/inbox-connection/use-inbox-connection"
import { Button } from "@/components/ui/button"
import type { OutreachStepProps } from "./outreach-step-model"
import { OutreachStepShell } from "./OutreachStepShell"

export function ConnectInboxStep({
  orgId,
  goNext,
  goBack,
  moving,
  moveError,
}: OutreachStepProps) {
  const access = useInboxConnection(orgId)
  const connected = access.state === "ready" && access.view.canSend

  return (
    <OutreachStepShell
      step={1}
      title="Connect your sending inbox"
      description="Your agent emails leads from an inbox you own."
      onPrevious={goBack}
      onNext={goNext}
      nextLabel={connected ? "Next step" : "Continue"}
      nextDisabled={moving}
      nextLoading={moving}
      moveError={moveError}
      {...(connected
        ? {}
        : {
            secondaryAction: (
              <Hint content="Nothing is sent until an inbox is connected. You can connect it later in Integrations.">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={moving}
                  onClick={goNext}
                >
                  Connect later
                </Button>
              </Hint>
            ),
          })}
    >
      <InboxConnection orgId={orgId} />
    </OutreachStepShell>
  )
}
