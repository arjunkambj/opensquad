/**
 * The two status chips of reference 20's header: how many signals the agent
 * is sourcing from, and whether the sending inbox is attached.
 *
 * Both are links to the page that changes the thing they report, which is the
 * only reason a status chip earns a place in a header. Neither invents a
 * state: the signal count is still loading until its query answers, and the
 * inbox line is the org's own `inboxConnection` in words.
 */
import { CheckmarkCircle02Icon, MailAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { InboxConnection } from "../../../convex/lib/validators"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The connection states in words, as a total map over the union — a state
 * added to `vInboxConnection` fails this build until it has a line.
 * `legacy_platform_inbox` receives but cannot send, and says so rather than
 * reading as "connected".
 */
const INBOX_LABEL: Record<InboxConnection, string> = {
  none: "Connect your inbox",
  legacy_platform_inbox: "Inbox receives only",
  connected: "Inbox connected",
  invalid: "Inbox needs attention",
}

export function DashboardStatusChips({
  activeSignals,
  inboxConnection,
}: {
  /** `undefined` while the signals query is still loading. */
  activeSignals: number | undefined
  inboxConnection: InboxConnection
}) {
  const connected = inboxConnection === "connected"
  return (
    <div className="flex flex-wrap items-center gap-2">
      {activeSignals === undefined ? (
        <Skeleton className="h-7 w-32 rounded-2xl" />
      ) : (
        <Button render={<Link to="/agent" />} size="sm" variant="outline">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            data-icon="inline-start"
            className={activeSignals > 0 ? "text-primary" : undefined}
          />
          {activeSignals === 0
            ? "No active signals"
            : `${activeSignals} active signal${activeSignals === 1 ? "" : "s"}`}
        </Button>
      )}
      <Button
        render={<Link to="/settings" search={{ tab: "inbox" }} />}
        size="sm"
        variant="outline"
      >
        <HugeiconsIcon
          icon={connected ? CheckmarkCircle02Icon : MailAdd01Icon}
          data-icon="inline-start"
          className={connected ? "text-primary" : "text-muted-foreground"}
        />
        {INBOX_LABEL[inboxConnection]}
      </Button>
    </div>
  )
}
