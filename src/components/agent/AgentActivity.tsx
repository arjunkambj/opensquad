/**
 * What the agent has done, newest first, as a day-grouped timeline.
 *
 * Reads the org's activity receipts a page at a time. The filter narrows the
 * pages already loaded rather than asking the server again: the feed has no
 * index by kind, and a filter that silently skipped older pages would claim
 * less happened than did.
 */
import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Coins01Icon,
  InboxIcon,
  InformationCircleIcon,
  MailSend01Icon,
  PlayIcon,
  QuillWrite02Icon,
  UserBlock01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useMinuteClock } from "@/hooks/use-minute-clock"
import { formatWaited } from "@/lib/presentation"

type ActivityEvent = FunctionReturnType<
  typeof api.activity.queries.list
>["items"][number]

const PAGE_SIZE = 30

const FILTERS = ["all", "runs", "replies", "drafts", "sending"] as const
type Filter = (typeof FILTERS)[number]

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  runs: "Runs",
  replies: "Replies",
  drafts: "Drafts",
  sending: "Sending",
}

function categoryOf(kind: string): Exclude<Filter, "all"> {
  if (kind === "run_finished" || kind === "credits_low") return "runs"
  if (kind === "reply_classified" || kind === "meeting_booked") return "replies"
  if (kind.startsWith("draft_") || kind === "approval_recorded") return "drafts"
  return "sending"
}

function iconOf(kind: string): IconSvgElement {
  switch (kind) {
    case "run_finished":
      return PlayIcon
    case "credits_low":
      return Coins01Icon
    case "reply_classified":
      return InboxIcon
    case "meeting_booked":
      return Calendar03Icon
    case "draft_created":
    case "draft_revised":
      return QuillWrite02Icon
    case "approval_recorded":
      return CheckmarkCircle02Icon
    case "suppression_added":
    case "suppression_removed":
      return UserBlock01Icon
    default:
      return kind.startsWith("send_attempt_") || kind.startsWith("delivery_")
        ? MailSend01Icon
        : InformationCircleIcon
  }
}

function actorName(actor: string): string {
  return actor === "workflow" || actor === "system" ? "Agent" : "You"
}

function dayKey(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

function dayHeading(at: number, timezone: string, now: number): string {
  const key = dayKey(at, timezone)
  if (key === dayKey(now, timezone)) return "Today"
  if (key === dayKey(now - 86_400_000, timezone)) return "Yesterday"
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(at)
}

export function AgentActivity({
  orgId,
  timezone,
}: {
  orgId: Id<"orgs">
  timezone: string
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [cursor, setCursor] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<ActivityEvent[]>([])
  const page = useQuery(api.activity.queries.list, {
    orgId,
    cursor,
    limit: PAGE_SIZE,
  })

  // Pages already read stay on screen while the next one loads.
  const loaded = page === undefined ? earlier : [...earlier, ...page.items]

  const events = loaded.filter(
    (event) => filter === "all" || categoryOf(event.kind) === filter,
  )
  const now = useMinuteClock()
  const groups: { heading: string; items: ActivityEvent[] }[] = []
  for (const event of events) {
    const heading = dayHeading(event.createdAt, timezone, now)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.heading === heading) {
      last.items.push(event)
    } else {
      groups.push({ heading, items: [event] })
    }
  }

  return (
    <FramedPanel title="Activity" bodyClassName="gap-3">
      <Tabs value={filter} onValueChange={(next: Filter) => setFilter(next)}>
        <TabsList aria-label="Filter activity">
          {FILTERS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {FILTER_LABEL[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {page === undefined && loaded.length === 0 ? (
        <ActivityTimelineSkeleton />
      ) : groups.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={PlayIcon}
          title={filter === "all" ? "Nothing yet" : `No ${FILTER_LABEL[filter].toLowerCase()} yet`}
          description="What your agent does shows up here as it happens."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.heading} className="flex flex-col gap-3">
              <h3 className="flex items-center gap-3 text-2xs font-medium tracking-eyebrow text-muted-foreground uppercase">
                {group.heading}
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </h3>
              <ol className="flex flex-col">
                {group.items.map((event, index) => (
                  <li key={event._id} className="relative flex gap-3 pb-3 last:pb-0">
                    {index < group.items.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-8 bottom-0 left-4 w-px bg-border"
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-panel text-illustration-accent"
                    >
                      <HugeiconsIcon icon={iconOf(event.kind)} strokeWidth={2} className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-1.5">
                      <p className="min-w-0 text-sm text-foreground">
                        <span className="font-medium">{actorName(event.actor)}</span>{" "}
                        <span className="text-muted-foreground">·</span>{" "}
                        {event.summary}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatWaited(event.createdAt, now)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {page !== undefined && page.hasMore && page.cursor !== null ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => {
            setEarlier(loaded)
            setCursor(page.cursor)
          }}
        >
          Show earlier
        </Button>
      ) : null}
    </FramedPanel>
  )
}

/** Mirrors the panel while the first page loads: the filter tabs over one day of timeline. */
export function AgentActivitySkeleton() {
  return (
    <FramedPanel title="Activity" bodyClassName="gap-3">
      <Skeleton shape="xl" className="h-8 w-72 max-w-full" />
      <ActivityTimelineSkeleton />
    </FramedPanel>
  )
}

/** A day heading and timeline rows at the real rows' height. */
function ActivityTimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="flex h-4 items-center gap-3">
        <Skeleton shape="full" className="h-2.5 w-16" />
        <span className="h-px flex-1 bg-border" />
      </div>
      <ol className="flex flex-col">
        {[
          <Skeleton key="a" shape="full" className="h-3.5 w-3/5" />,
          <Skeleton key="b" shape="full" className="h-3.5 w-2/5" />,
          <Skeleton key="c" shape="full" className="h-3.5 w-1/2" />,
        ].map((line) => (
          <li key={line.key} className="flex gap-3 pb-3 last:pb-0">
            <Skeleton shape="full" className="size-8 shrink-0" />
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-1.5">
              <div className="flex h-5 flex-1 items-center">{line}</div>
              <div className="flex h-4 items-center">
                <Skeleton shape="full" className="h-3 w-12" />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
