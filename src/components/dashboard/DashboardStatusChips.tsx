import { AudioLinesIcon, InboxIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { InboxConnection } from "../../../convex/lib/validators"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const INBOX_LABEL: Record<InboxConnection, string> = {
  none: "Connect your inbox",
  connected: "Inbox connected",
  invalid: "Inbox needs attention",
}

export function DashboardStatusChips({
  activeSignals,
  inboxConnection,
}: {
  activeSignals: number | undefined
  inboxConnection: InboxConnection
}) {
  const connected = inboxConnection === "connected"
  return (
    <div className="flex flex-wrap items-center gap-2">
      {activeSignals === undefined ? (
        <Skeleton shape="xl" className="h-8 w-36" />
      ) : (
        <Hint content="Signals are the searches your agent runs to find leads. Open to switch them on or off.">
          <Button render={<Link to="/signals" />} variant="outline">
            <HugeiconsIcon
              icon={AudioLinesIcon}
              data-icon="inline-start"
              className={activeSignals > 0 ? "text-primary" : undefined}
            />
            {activeSignals === 0
              ? "No active signals"
              : `${activeSignals} active signal${activeSignals === 1 ? "" : "s"}`}
          </Button>
        </Hint>
      )}
      <Hint
        content={
          connected
            ? "Outreach is sent from this AgentMail inbox, and replies come back to your Inbox."
            : "Your agent can find and research leads, but nothing is sent until an inbox is connected."
        }
      >
        <Button
          render={<Link to="/integrations" />}
          variant="outline"
        >
          <HugeiconsIcon
            icon={InboxIcon}
            data-icon="inline-start"
            className={connected ? "text-primary" : "text-muted-foreground"}
          />
          {INBOX_LABEL[inboxConnection]}
        </Button>
      </Hint>
    </div>
  )
}
