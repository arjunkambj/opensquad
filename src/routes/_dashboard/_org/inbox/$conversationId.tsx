import { createFileRoute, useParams } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { ConversationPane } from "@/components/inbox/ConversationPane"

export const Route = createFileRoute(
  "/_dashboard/_org/inbox/$conversationId",
)({
  component: ConversationRoute,
})

/** The parent dashboard boundary handles foreign or malformed IDs without removing the shell. */
function ConversationRoute() {
  const { conversationId } = useParams({
    from: "/_dashboard/_org/inbox/$conversationId",
  })

  return (
    <ConversationPane conversationId={conversationId as Id<"conversations">} />
  )
}
