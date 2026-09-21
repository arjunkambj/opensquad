import { Link } from "@tanstack/react-router"
import type { Id } from "../../../convex/_generated/dataModel"
import { InboxConnection } from "@/components/inbox-connection/InboxConnection"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function InboxTab({ orgId }: { orgId: Id<"orgs"> }) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Sending inbox</CardTitle>
          <CardDescription>
            Outreach is sent from your own AgentMail inbox, using a key you
            paste here. It is encrypted before it is stored, and replies come
            straight back into your Inbox.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InboxConnection orgId={orgId} />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Sending days, hours and the daily limit are in{" "}
        <Link
          to="/settings"
          search={{ tab: "sending" }}
          className="text-primary underline-offset-4 hover:underline"
        >
          Sending
        </Link>
        .
      </p>
    </div>
  )
}
