import { Notification03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { activityPresentation } from "@/components/layout/activity-presentation"
import { formatInstant } from "@/lib/presentation"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"

const FEED_LIMIT = 8

export function NotificationsBell({
  orgId,
}: {
  orgId: Id<"orgs"> | undefined
}) {
  const { setOpenMobile } = useSidebar()
  const feed = useQuery(
    api.activity.queries.list,
    orgId === undefined ? "skip" : { orgId, limit: FEED_LIMIT },
  )

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        render={<Button size="icon" variant="muted" />}
      >
        <HugeiconsIcon icon={Notification03Icon} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-3" side="bottom">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          <Link
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            to="/overview"
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

type Feed = FunctionReturnType<typeof api.activity.queries.list> | undefined

const FEED_SKELETON_ROWS = [0, 1, 2] as const

function NotificationsFeed({ feed }: { feed: Feed }) {
  if (feed === undefined) {
    return (
      <ul aria-hidden="true" className="flex flex-col gap-0.5">
        {FEED_SKELETON_ROWS.map((row) => (
          <li key={row} className="flex items-start gap-2.5 px-1 py-2">
            <Skeleton shape="full" className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-5 items-center">
                <Skeleton shape="full" className="h-3.5 w-28" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton shape="full" className="h-3 w-48" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton shape="full" className="h-2.5 w-20" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  if (feed.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-2xl border border-border px-4 py-6 text-center">
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
              <p className="text-2xs text-muted-foreground">
                {formatInstant(event.createdAt)}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
