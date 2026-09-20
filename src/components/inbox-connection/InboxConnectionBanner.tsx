/**
 * The container for `ConnectInboxBanner`: it reads the workspace's inbox
 * connection and renders the banner only while the workspace cannot send.
 *
 * Mounted by the Agent and Contacts screens (EXECUTION T31, T32). A connected
 * workspace renders nothing at all — a banner that says "you are fine" is
 * chrome, and the reference screens do not carry one.
 */
import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { ConnectInboxBanner } from "./ConnectInboxBanner"

export function InboxConnectionBanner({
  workspaceId,
  className,
}: {
  workspaceId: Id<"workspaces">
  className?: string
}) {
  // The read is owner-guarded, so anyone else is not asked — and is not shown
  // a banner pointing at a screen they cannot act on either.
  const current = useCurrentWorkspace()
  const isOwner =
    current !== undefined &&
    current !== null &&
    current.workspace._id === workspaceId &&
    current.role === "owner"
  const view = useQuery(
    api.inbox.connection.getInboxConnection,
    isOwner ? { workspaceId } : "skip",
  )

  // While the read is in flight there is nothing to warn about yet, and a
  // skeleton above the page content would move it twice.
  if (view === undefined || view.canSend) {
    return null
  }

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
