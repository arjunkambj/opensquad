import { createFileRoute, useParams } from "@tanstack/react-router"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { ConversationDetail } from "@/components/inbox/ConversationDetail"

export const Route = createFileRoute(
  "/_dashboard/_workspace/inbox/$conversationId",
)({
  component: ConversationPage,
})

/**
 * One thread, at its own URL — a conversation is a record, and V15/V16 work
 * the same reply from two sessions, which needs a link someone can paste.
 *
 * No error boundary here: `_dashboard` already maps NOT_FOUND (a foreign or
 * cross-workspace id) to an in-shell empty state, and a malformed id is
 * rendered the same way — the reviewer keeps the sidebar either way.
 */
function ConversationPage() {
  const { conversationId } = useParams({
    from: "/_dashboard/_workspace/inbox/$conversationId",
  })

  // Keyed on the id so the pinned contextVersion — the version the operator
  // actually saw — resets when the route param changes without unmounting.
  return (
    <ConversationDetail
      key={conversationId}
      conversationId={conversationId as Id<"conversations">}
    />
  )
}
