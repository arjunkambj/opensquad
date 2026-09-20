import { CatchBoundary, useNavigate, useSearch } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { actorLabel, formatInstant } from "@/components/shared/presentation"
import { OverviewDateRangePicker } from "@/components/overview/OverviewDateRangePicker"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  activityRangeToBounds,
  activityRangeToCalendar,
  calendarRangeToSearch,
} from "@/lib/date-ranges"
import { withFilters } from "@/lib/search-params"
import { OVERVIEW_DEFAULTS } from "@/routes/_dashboard/_workspace/overview"

const OVERVIEW_ROUTE = "/_dashboard/_workspace/overview"

/**
 * No `timeZone` option, deliberately. `picker.value` holds **civil days** —
 * browser-local midnights standing for wall-calendar dates that
 * `date-ranges.ts` already derived in the workspace's zone. Converting them
 * again here would shift the label off the day whose bounds were sent.
 */
const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

/**
 * Dated receipts, with the date picker attached **to this section** and not to
 * the page.
 *
 * That placement is the whole point. `activity.list` is the only query in this
 * screen that takes `from`/`to`. A picker sitting in the page header would
 * read as though it filters everything below it, which would mean unfinished
 * work could be hidden by a date range.
 *
 * The cursor for this feed is the one that belongs in the URL: a dated
 * receipts position is shared context, so `?range=30d&cursor=…` is a link
 * worth pasting.
 */
export function ActivityFeed({
  workspaceId,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  timezone: string
}) {
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const navigate = useNavigate()

  const range = search.range ?? OVERVIEW_DEFAULTS.range
  // The window is the WORKSPACE's day, not the browser's. Every row below is
  // stamped with `formatInstant(…, timezone)` and every send allowance in this
  // product is bucketed by the workspace zone, so a window derived from the
  // browser would head one day and list another's receipts.
  const bounds = activityRangeToBounds(range, search.from, search.to, timezone)
  const picker = activityRangeToCalendar(
    range,
    search.from,
    search.to,
    timezone,
  )

  const label =
    picker.value.start.getTime() === picker.value.end.getTime()
      ? dateFormatter.format(picker.value.start)
      : `${dateFormatter.format(picker.value.start)} – ${dateFormatter.format(picker.value.end)}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>
          Receipts for what already happened, in the window you pick. This date
          range never hides unfinished work — the board above is not filtered
          by it.
        </CardDescription>
        <div className="pt-1">
          <OverviewDateRangePicker
            value={picker.value}
            preset={picker.preset}
            timezone={timezone}
            onChange={(nextRange, nextPreset) => {
              const chosen = calendarRangeToSearch(
                nextRange,
                nextPreset,
                timezone,
              )
              void navigate({
                to: "/overview",
                // A range change is a filter change, so the cursor goes with
                // it — page two of one window must never render as page two
                // of another.
                search: withFilters(search, {
                  range:
                    chosen.range === OVERVIEW_DEFAULTS.range
                      ? undefined
                      : chosen.range,
                  from: chosen.from,
                  to: chosen.to,
                }),
              })
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* The `activity.list` query lives inside this boundary so a stale or
            foreign `?cursor=` throws HERE — never the whole overview — the
            same arrangement the leads/inbox/decisions lists use. */}
        <CatchBoundary
          getResetKey={() =>
            `${range}:${search.from ?? ""}:${search.to ?? ""}:${search.cursor ?? ""}`
          }
          errorComponent={ActivityFeedError}
        >
          <ActivityFeedBody
            workspaceId={workspaceId}
            timezone={timezone}
            bounds={bounds}
            label={label}
            cursor={search.cursor}
          />
        </CatchBoundary>
      </CardContent>
    </Card>
  )
}

function ActivityFeedBody({
  workspaceId,
  timezone,
  bounds,
  label,
  cursor,
}: {
  workspaceId: Id<"workspaces">
  timezone: string
  bounds: { from: number; to: number }
  label: string
  cursor: string | undefined
}) {
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const navigate = useNavigate()

  const page = useQuery(api.activity.list, {
    workspaceId,
    from: bounds.from,
    to: bounds.to,
    ...(cursor === undefined ? {} : { cursor }),
  })

  return (
    <>
      {page === undefined ? (
          <LoadingState
            title="Loading activity"
            description={`Reading receipts for ${label}.`}
          />
        ) : page.items.length === 0 ? (
          search.cursor !== undefined ? (
            <EmptyState
              title="Nothing further on this page"
              description="This is a link to a later page of the feed, and there is nothing on it. Earlier receipts may still be on the first page."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigate({
                      to: "/overview",
                      search: { ...search, cursor: undefined },
                    })
                  }
                >
                  Back to the first page
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={`No activity in ${label}`}
              description="Nothing was recorded in this window."
            />
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((event) => (
              <li key={event._id}>
                <div className="flex flex-col gap-0.5 rounded-[min(var(--radius-4xl),24px)] bg-muted/40 px-4 py-2">
                  <span className="text-sm text-foreground">
                    {event.summary}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {actorLabel(event.actor)} ·{" "}
                    {formatInstant(event.createdAt, timezone)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {page === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {search.cursor === undefined ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/overview",
                    search: { ...search, cursor: undefined },
                  })
                }
              >
                First page
              </Button>
            )}
            {page.hasMore && page.cursor !== null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/overview",
                    search: { ...search, cursor: page.cursor ?? undefined },
                  })
                }
              >
                Next page
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Showing {label}.{" "}
              {page.hasMore
                ? "More receipts than fit on one page."
                : "End of this window."}
            </p>
          </div>
        )}
    </>
  )
}

/**
 * Expired/foreign cursor or a failed page — inside the feed, not the route.
 * A stale cursor re-throws on every bare `reset`, so the recovery navigates
 * to the first page (which also remounts the boundary via `getResetKey`)
 * rather than retrying a query that can never succeed.
 */
function ActivityFeedError({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate()
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const cursorProblem = error instanceof Error && /cursor/i.test(error.message)
  return (
    <ErrorState
      title={
        cursorProblem
          ? "This page link is no longer valid"
          : "The activity feed didn't load"
      }
      description={
        cursorProblem
          ? "The feed moved on since this link was made — the page cursor it carries no longer resolves."
          : "Receipts could not be loaded. Nothing here was changed."
      }
      onRetry={
        cursorProblem
          ? () =>
              void navigate({
                to: "/overview",
                search: { ...search, cursor: undefined },
              })
          : reset
      }
      retryLabel={cursorProblem ? "Back to the first page" : "Try again"}
    />
  )
}
