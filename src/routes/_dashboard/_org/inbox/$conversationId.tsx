import { createFileRoute, useParams } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { ConversationPane } from "@/components/inbox/ConversationPane"

export const Route = createFileRoute(
  "/_dashboard/_org/inbox/$conversationId",
)({
  component: ConversationRoute,
})

/**
 * One thread at its own URL — a conversation is a record someone pastes to a
 * colleague, so it is a path segment rather than a pane state.
 *
 * No error boundary here: `_dashboard` already renders a foreign or malformed
 * id as an in-shell empty state, which keeps the sidebar and the list.
 */
function ConversationRoute() {
  const { conversationId } = useParams({
    from: "/_dashboard/_org/inbox/$conversationId",
  })

  return (
    <ConversationPane conversationId={conversationId as Id<"conversations">} />
  )
}
