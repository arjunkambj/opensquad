/** Connecting or skipping an inbox keeps the agent in sourcing_only.
 * Review and Autopilot require an explicit mode change on the Agent page. */
import { MailValidation01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { ConnectCard } from "@/components/kit/ConnectCard"
import { InboxConnection } from "@/components/inbox-connection/InboxConnection"
import { useInboxConnection } from "@/components/inbox-connection/use-inbox-connection"
import { Button } from "@/components/ui/button"
import type { OutreachStepProps } from "./outreach-step-model"
import { OutreachStepShell } from "./OutreachStepShell"

const BENEFITS = [
  "Outreach and follow-ups go out from your own address, not ours",
  "Replies come straight back into your Inbox, thread by thread",
  "Your key is encrypted before it is stored, and can be replaced any time",
]

export function ConnectInboxStep({
  orgId,
  goNext,
  goBack,
}: OutreachStepProps) {
  const access = useInboxConnection(orgId)
  const connected = access.state === "ready" && access.view.canSend

  return (
    <OutreachStepShell
      step={1}
      title="Connect your sending inbox"
      description="Your agent emails leads from an inbox you own, so replies land where you already work."
      onPrevious={goBack}
      onNext={goNext}
      nextLabel={connected ? "Next step" : "Continue"}
      {...(connected
        ? {}
        : {
            secondaryAction: (
              <Button type="button" variant="ghost" size="cta" onClick={goNext}>
                Connect later
              </Button>
            ),
          })}
    >
      <ConnectCard
        icon={
          <HugeiconsIcon
            icon={MailValidation01Icon}
            strokeWidth={2}
            className="size-5 text-primary"
            aria-hidden="true"
          />
        }
        title="Connect your email account"
        benefits={BENEFITS}
        action={<InboxConnection orgId={orgId} />}
      />
      {connected ? null : (
        <p className="mt-4 text-sm text-muted-foreground">
          You can skip this. Until an inbox is connected your agent finds and
          researches leads and sends nothing, and you can connect it later in
          Settings.
        </p>
      )}
    </OutreachStepShell>
  )
}
