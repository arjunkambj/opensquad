import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { useInboxAttention } from "@/hooks/use-inbox-attention"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * "What needs a person", in two bounded counts — the first thing the
 * operator sees on `/leads`, the signed-in home.
 *
 * Each slot shows what its count is OF, because a bare number cannot be
 * checked:
 *
 * - **Unassigned mail** — `conversations.attentionCounts.unassigned`, the
 *   exact bucket for threads no lead has claimed (bounded at 50+). The
 *   sidebar Inbox badge shows the *different* `needsAttention` sum — same
 *   query, deliberately different number, each labelled for what it is.
 * - **Overdue next actions** — `prospects.countOverdue`, the bounded count of
 *   leads whose `nextActionDueAt` is past. The tile links to the Due list
 *   pre-filtered to `?mode=due&due=overdue`.
 */
export function AttentionBlock({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">
}) {
  const inboxAttention = useInboxAttention(workspaceId)
  const overdue = useQuery(api.prospects.countOverdue, { workspaceId })

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardDescription>Unassigned mail</CardDescription>
          <CardTitle
            className="font-heading text-3xl tabular-nums"
            aria-live="polite"
          >
            {inboxAttention === undefined
              ? "—"
              : inboxAttention.unassignedHasMore
                ? `${inboxAttention.unassigned}+`
                : inboxAttention.unassigned}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">
            {inboxAttention === undefined
              ? "Counting replies no lead has claimed."
              : inboxAttention.unassigned === 0
                ? "Every reply is matched to a lead."
                : "Replies that landed with no lead to claim them wait under takeover until a person links them."}
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/inbox" search={{ tab: "unassigned" }} />}
          >
            Review unassigned mail
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Overdue next actions</CardDescription>
          <CardTitle
            className="font-heading text-3xl tabular-nums"
            aria-live="polite"
          >
            {overdue === undefined
              ? "—"
              : overdue.hasMore
                ? `${overdue.count}+`
                : overdue.count}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">
            {overdue === undefined
              ? "Counting leads past their next action's due time."
              : overdue.count === 0
                ? "Nothing is past its due time."
                : "Leads whose next action is past its due time, most overdue first on the due list."}
          </p>
          <Button
            variant="outline"
            size="sm"
            render={
              <Link to="/leads" search={{ mode: "due", due: "overdue" }} />
            }
          >
            Open the due list
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
