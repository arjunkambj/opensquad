import {
  MailAdd01Icon,
  MailOpen01Icon,
  MailRemove01Icon,
} from "@hugeicons/core-free-icons"
import { useState } from "react"
import { ConnectInboxDialog } from "@/components/inbox-connection/ConnectInboxDialog"
import { InboxStartPaneSkeleton } from "@/components/inbox/InboxPageSkeleton"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentOrg } from "@/hooks/use-current-org"

export function InboxStartPane() {
  const current = useCurrentOrg()
  const [connecting, setConnecting] = useState(false)

  if (current.status !== "ready") {
    return <InboxStartPaneSkeleton />
  }

  const connection = current.org.inboxConnection
  if (connection === "none" || connection === "invalid") {
    const reconnect = connection === "invalid"
    return (
      <EmptyState
        variant="plain"
        className="h-full rounded-card border border-border xl:rounded-none xl:border-0"
        icon={reconnect ? MailRemove01Icon : MailAdd01Icon}
        title={reconnect ? "Your inbox needs reconnecting" : "Connect your inbox"}
        description={
          reconnect
            ? "Sending and replies are paused until you do."
            : "Your agent sends from it, and replies land here."
        }
        action={
          <>
            <Button onClick={() => setConnecting(true)}>
              {reconnect ? "Reconnect inbox" : "Connect inbox"}
            </Button>
            <ConnectInboxDialog
              orgId={current.org._id}
              reconnect={reconnect}
              open={connecting}
              onOpenChange={setConnecting}
            />
          </>
        }
      />
    )
  }

  // At phone and tablet width the list occupies the page on its own, so this
  // prompt would be a second empty state under it.
  return (
    <EmptyState
      variant="plain"
      className="hidden h-full xl:flex"
      icon={MailOpen01Icon}
      title="Select a conversation"
      description={
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
          <Shortcut keys={["J", "K"]} label="Move" />
          <Shortcut keys={["Enter"]} label="Open" />
          <Shortcut keys={["Esc"]} label="Back" />
        </ul>
      }
    />
  )
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-sans text-2xs font-medium text-foreground"
        >
          {key}
        </kbd>
      ))}
      <span>{label}</span>
    </li>
  )
}
