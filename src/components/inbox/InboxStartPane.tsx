/**
 * The reading pane before a thread is chosen (reference 24's right half).
 *
 * Two different nothings, never conflated:
 *
 * - no inbox connected → the connect card, because nothing can arrive until
 *   one is. `InboxConnection` is owner-guarded inside and shows a non-owner
 *   the permission note instead of a form they cannot submit.
 * - connected → the prompt to pick a conversation.
 */
import { Message01Icon } from "@hugeicons/core-free-icons"
import { InboxConnection } from "@/components/inbox-connection/InboxConnection"
import { EmptyState, LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"

export function InboxStartPane() {
  const current = useCurrentOrg()

  if (current.status !== "ready") {
    return <LoadingState title="Loading your inbox" />
  }

  const connection = current.org.inboxConnection
  if (connection === "none" || connection === "invalid") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-semibold text-foreground">
            {connection === "none"
              ? "Connect your sending inbox"
              : "Reconnect your sending inbox"}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {connection === "none"
              ? "Conversations appear here once the agent can send from your own inbox. Replies sync in the background."
              : "The stored key was refused, so sending and replies are paused. Reconnect to start them again."}
          </p>
        </div>
        <InboxConnection orgId={current.org._id} />
      </div>
    )
  }

  // At phone and tablet width the list occupies the page on its own, so this
  // prompt would be a second empty state under it.
  return (
    <EmptyState
      className="hidden xl:flex"
      icon={Message01Icon}
      title="Pick a conversation"
      description="Choose a thread on the left to read it, approve the reply waiting on it, or mark the meeting it produced."
    />
  )
}
