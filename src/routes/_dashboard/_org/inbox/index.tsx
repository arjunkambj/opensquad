import { createFileRoute } from "@tanstack/react-router"
import { InboxStartPane } from "@/components/inbox/InboxStartPane"

export const Route = createFileRoute("/_dashboard/_org/inbox/")({
  component: InboxStartPane,
})
