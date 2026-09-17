import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatInstant } from "@/components/decisions/decision-presentation"
import { actorLabel } from "@/components/missions/MissionReceipts"
import { OverviewDateRangePicker } from "@/components/overview/OverviewDateRangePicker"
import { EmptyState, LoadingState } from "@/components/states/states"
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
 * screen that takes `from`/`to`; `missions.listBoard` takes no date arguments
 * and physically cannot be date-filtered. A picker sitting in the page header
 * reads as though it filters everything below it, which would mean an old
 * unfinished mission could be hidden by a date range — the defect
 * `plan/architecture.md` §5 calls out by name.
 *
 * The cursor for this feed is the one that belongs in the URL: a dated
 * receipts position is shared context, so `?range=30d&cursor=…` is a link
 * worth pasting. The board's four column cursors deliberately stay local.
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

  const page = useQuery(api.activity.list, {
    workspaceId,
    from: bounds.from,
    to: bounds.to,
    ...(search.cursor === undefined ? {} : { cursor: search.cursor }),
  })

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
              description="Nothing was recorded in this window. Work in progress is on the board above — it is never hidden by this date range."
            />
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((event) => (
              <li key={event._id}>
                <Link
                  to="/overview/missions/$missionId"
                  params={{ missionId: event.missionId }}
                  search={true}
                  className="flex flex-col gap-0.5 rounded-[min(var(--radius-4xl),24px)] bg-muted/40 px-4 py-2 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <span className="text-sm text-foreground">
                    {event.summary}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {actorLabel(event.actor)} ·{" "}
                    {formatInstant(event.createdAt, timezone)}
                  </span>
                </Link>
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
      </CardContent>
    </Card>
  )
}
