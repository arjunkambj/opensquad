/**
 * The container for `ConnectInboxBanner`: it reads the workspace's inbox
 * connection and renders the banner only while the workspace cannot send.
 *
 * Mounted by the Agent and Contacts screens (EXECUTION T31, T32). A connected
 * workspace renders nothing at all — a banner that says "you are fine" is
 * chrome, and the reference screens do not carry one. Neither does a reader
 * who cannot act on it: the connect screen is owner-only.
 */
import { Link } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { ConnectInboxBanner } from "./ConnectInboxBanner"
import { useInboxConnection } from "./use-inbox-connection"

export function InboxConnectionBanner({
  workspaceId,
  className,
}: {
  workspaceId: Id<"workspaces">
  className?: string
}) {
  const access = useInboxConnection(workspaceId)

  // While the read is in flight there is nothing to warn about yet, and a
  // skeleton above the page content would move it twice.
  if (access.state !== "ready" || access.view.canSend) {
    return null
  }
  const view = access.view

  const settingsLink = (label: string) => (
    <Button
      size="sm"
      render={<Link to="/settings" search={{ tab: "inbox" }} />}
    >
      {label}
    </Button>
  )

  if (view.connection === "invalid") {
    return (
      <ConnectInboxBanner
        tone="attention"
        title="Reconnect your sending inbox"
        description="The stored key was refused, so sending and replies are paused. Leads are still being found."
        action={settingsLink("Reconnect")}
        {...(className !== undefined ? { className } : {})}
      />
    )
  }

  return (
    <ConnectInboxBanner
      title="Connect inbox to start sending"
      description={
        view.connection === "legacy_platform_inbox"
          ? "This workspace can read mail but cannot send. Connect your own inbox to start outreach."
          : "The agent finds and researches leads now, and contacts nobody until an inbox is connected."
      }
      action={settingsLink("Connect inbox")}
      {...(className !== undefined ? { className } : {})}
    />
  )
}
