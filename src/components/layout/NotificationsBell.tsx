import { Notification03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { activityPresentation } from "@/components/layout/activity-presentation"
import { formatInstant } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"

/** The feed is a glance, not a page: the newest few, then the dashboard. */
const FEED_LIMIT = 8

/**
 * The bell of reference 20 — the workspace's newest activity, on the spot.
 *
 * Every row is an event the backend recorded (`activity.queries.list`), never
 * a derived guess, and the kind is rendered through a total map so a new kind
 * is a build failure rather than a blank row.
 */
export function NotificationsBell({
  workspaceId,
}: {
  workspaceId: Id<"workspaces"> | undefined
}) {
  const { setOpenMobile } = useSidebar()
  const feed = useQuery(
    api.activity.queries.list,
    workspaceId === undefined ? "skip" : { workspaceId, limit: FEED_LIMIT },
  )

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        render={<Button className="text-muted-foreground" size="icon" variant="ghost" />}
      >
        <HugeiconsIcon icon={Notification03Icon} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-3" side="bottom">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          <Link
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            to="/dashboard"
            onClick={() => setOpenMobile(false)}
          >
            See all activity
          </Link>
        </div>
        <NotificationsFeed feed={feed} />
      </PopoverContent>
    </Popover>
  )
}

/** `undefined` while the subscription is still loading. */
type Feed = FunctionReturnType<typeof api.activity.queries.list> | undefined

function NotificationsFeed({ feed }: { feed: Feed }) {
  if (feed === undefined) {
    return (
      <div className="flex flex-col gap-2 px-1">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  if (feed.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-dashed border-border px-4 py-6 text-center">
        <HugeiconsIcon
          icon={Notification03Icon}
          className="size-5 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-foreground">Nothing yet</p>
        <p className="text-xs text-muted-foreground">
          Replies, sends and finished runs show up here as the agent works.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {feed.items.map((event) => {
        const presentation = activityPresentation(event.kind)
        return (
          <li
            key={event._id}
            className="flex items-start gap-2.5 rounded-xl px-1 py-2"
          >
            <HugeiconsIcon
              icon={presentation.icon}
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {presentation.label}
              </p>
              <p className="text-xs break-words text-muted-foreground">
                {event.summary}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatInstant(event.createdAt)}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
