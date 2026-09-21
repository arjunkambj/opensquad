import { Link } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { ConnectInboxBanner } from "./ConnectInboxBanner"
import { useInboxConnection } from "./use-inbox-connection"

export function InboxConnectionBanner({
  orgId,
  className,
}: {
  orgId: Id<"orgs">
  className?: string
}) {
  const access = useInboxConnection(orgId)

  // While the read is in flight there is nothing to warn about yet, and a
  // skeleton above the page content would move it twice.
  if (access.state !== "ready" || access.view.canSend) {
    return null
  }
  const view = access.view

  const integrationsLink = (label: string) => (
    <Button
      size="sm"
      render={<Link to="/integrations" />}
    >
      {label}
    </Button>
  )

  if (view.connection === "invalid") {
    return (
      <ConnectInboxBanner
        tone="attention"
        title="Reconnect your sending inbox"
        description="Sending is paused. Reconnect to resume."
        action={integrationsLink("Reconnect")}
        {...(className !== undefined ? { className } : {})}
      />
    )
  }

  return (
    <ConnectInboxBanner
      title="Connect inbox to start sending"
      description="Leads are found now. Nobody is contacted until you connect."
      action={integrationsLink("Connect inbox")}
      {...(className !== undefined ? { className } : {})}
    />
  )
}
