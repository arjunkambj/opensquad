/**
 * "Latest replies" (reference 20) — threads someone replied in during this
 * window, newest reply first.
 *
 * There is no message body on a conversation row, so there is no preview line
 * here. What the row does carry is who replied, when, and the classification
 * the reply handler recorded; a one-line summary of someone's email would
 * have to be invented, and that is the one thing this panel must not print.
 *
 * Two empty states, because they mean different things: no inbox connected is
 * a thing to go and do, and a connected but quiet inbox is simply quiet.
 *
 * Presentational: the container owns the query.
 */
import { BubbleChatIcon, MailAdd01Icon } from "@hugeicons/core-free-icons"
import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import type { ReplyDisposition } from "../../../convex/lib/validators"
import { EmptyState } from "@/components/kit/EmptyState"
import { PanelFrame } from "@/components/dashboard/PanelFrame"
import { Chip, formatInstant } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export type LatestRepliesData = FunctionReturnType<
  typeof api.dashboard.panels.latestReplies
>

/**
 * What the reply handler concluded, in words — a total map over the union, so
 * a disposition added to the backend fails this build until it has a label.
 */
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
  /** `undefined` while the query is still reading. */
  replies: LatestRepliesData | undefined
  hint: string
  /** The workspace's zone — every timestamp on this screen is on its clock. */
  timezone: string
}) {
  return (
    <PanelFrame
      icon={BubbleChatIcon}
      title="Latest replies"
      description={`People who wrote back · ${hint}`}
      action={
        replies !== undefined && replies.items.length > 0 ? (
          <Button render={<Link to="/inbox" />} size="sm" variant="ghost">
            Open inbox
          </Button>
        ) : null
      }
    >
      {replies === undefined ? (
        <div className="flex flex-col gap-2 px-5 pb-5">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : replies.inboxConnection !== "connected" &&
        replies.items.length === 0 ? (
        <EmptyState
          icon={MailAdd01Icon}
          title="Connect your inbox to never miss a reply"
          description="Replies land here as soon as your agent is sending from your own inbox."
          action={
            <Button
              render={<Link to="/settings" search={{ tab: "inbox" }} />}
              size="sm"
            >
              Connect your inbox
            </Button>
          }
        />
      ) : replies.items.length === 0 ? (
        <EmptyState
          icon={BubbleChatIcon}
          title="No replies in this window"
          description="Your inbox is connected and quiet. Every reply your agent receives shows up here."
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
                className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40"
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
                  <Chip>{DISPOSITION_LABEL[reply.disposition]}</Chip>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  )
}
