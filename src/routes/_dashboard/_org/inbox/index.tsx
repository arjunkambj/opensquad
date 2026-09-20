import { createFileRoute } from "@tanstack/react-router"
import { InboxStartPane } from "@/components/inbox/InboxStartPane"

/**
 * The reading pane with no thread chosen. The route exists because the inbox
 * layout needs an index child; what it shows depends on whether an inbox is
 * connected yet, which `InboxStartPane` reads.
 */
export const Route = createFileRoute("/_dashboard/_workspace/inbox/")({
  component: InboxStartPane,
})
