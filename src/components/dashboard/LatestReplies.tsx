import { InboxIcon } from "@hugeicons/core-free-icons"
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import type { ReplyDisposition } from "../../../convex/lib/validators"
import { EmptyState } from "@/components/states/states"
import { PanelFrame, PanelRowsSkeleton } from "@/components/dashboard/PanelFrame"
import { DISPOSITION_VARIANT } from "@/components/inbox/inbox-presentation"
import { Chip } from "@/components/kit/Chip"
import { formatInstant } from "@/lib/presentation"
import { Button } from "@/components/ui/button"

export type LatestRepliesData = FunctionReturnType<
  typeof api.dashboard.panels.latestReplies
>

const DISPOSITION_LABEL: Record<ReplyDisposition, string> = {
  interested: "Interested",
  question: "Question",
  not_now: "Not now",
  not_interested: "Not interested",
  unsubscribe: "Unsubscribed",
  automated: "Auto-reply",
  needs_review: "Needs review",
}

export function LatestReplies({
  replies,
  hint,
  timezone,
}: {
  replies: LatestRepliesData | undefined
  hint: string
  timezone: string
}) {
  return (
    <PanelFrame
      icon={InboxIcon}
      title="Latest replies"
      description={`People who wrote back · ${hint}`}
      action={
        replies !== undefined && replies.items.length > 0 ? (
          <Button render={<Link to="/inbox" />} size="xs" variant="ghost">
            Open inbox
          </Button>
        ) : null
      }
    >
      {replies === undefined ? (
        <PanelRowsSkeleton trailing="chip" />
      ) : replies.items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={InboxIcon}
          title="No replies yet"
          description="Replies to your outreach will show up here."
          action={
            <Button render={<Link to="/inbox" />} variant="outline">
              Open inbox
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {replies.items.map((reply) => (
            <li
              key={reply.conversationId}
              className="border-t border-border first:border-t-0"
            >
              <Link
                to="/inbox/$conversationId"
                params={{ conversationId: reply.conversationId }}
                className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {reply.name ?? reply.fromAddress ?? "Unnamed contact"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {reply.companyName === undefined
                      ? formatInstant(reply.repliedAt, timezone)
                      : `${reply.companyName} · ${formatInstant(reply.repliedAt, timezone)}`}
                  </span>
                </div>
                {reply.disposition === undefined ? null : (
                  <Chip variant={DISPOSITION_VARIANT[reply.disposition]}>
                    {DISPOSITION_LABEL[reply.disposition]}
                  </Chip>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}
