/**
 * Dashboard — the dated receipt feed of what the org has done.
 *
 * Read-only: every row is an activity event the backend recorded, never a
 * derived guess, and the date range comes from the route's search contract.
 */
import { CatchBoundary, useNavigate, useSearch } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { actorLabel, formatInstant } from "@/components/shared/presentation"
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

const DASHBOARD_ROUTE = "/_dashboard/_org/dashboard"

/**
 * Dated receipts — the feed the sidebar bell's "See all activity" leads to,
 * at the foot of the dashboard.
 *
 * It reads the SAME window the range pills chose for everything above it,
 * handed down as `bounds` rather than re-derived, so the page can never head
 * one window and list another's receipts. Only the page cursor is its own,
 * and that is the one part of this screen worth pasting: `?range=30d&cursor=…`
 * reopens the same page of the same window.
 */
export function ActivityFeed({
  orgId,
  timezone,
  bounds,
  hint,
}: {
  orgId: Id<"orgs">
  /** The org's zone — every row below is stamped on its clock. */
  timezone: string
  /** The window the range pills chose, in the org's own days. */
  bounds: { from: number; to: number }
  /** That window in words, e.g. "Last 30 days". */
  hint: string
}) {
  const search = useSearch({ from: DASHBOARD_ROUTE })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>
          Receipts for what already happened, over the same window as the rest
          of this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* The `activity.list` query lives inside this boundary so a stale or
            foreign `?cursor=` throws HERE — never the whole dashboard — the
            same arrangement the leads and inbox lists use. */}
        <CatchBoundary
          getResetKey={() =>
            `${bounds.from}:${bounds.to}:${search.cursor ?? ""}`
          }
          errorComponent={ActivityFeedError}
        >
          <ActivityFeedBody
            orgId={orgId}
            timezone={timezone}
            bounds={bounds}
            label={hint}
            cursor={search.cursor}
          />
        </CatchBoundary>
      </CardContent>
    </Card>
  )
}

function ActivityFeedBody({
  orgId,
  timezone,
  bounds,
  label,
  cursor,
}: {
  orgId: Id<"orgs">
  timezone: string
  bounds: { from: number; to: number }
  label: string
  cursor: string | undefined
}) {
  const search = useSearch({ from: DASHBOARD_ROUTE })
  const navigate = useNavigate()

  const page = useQuery(api.activity.queries.list, {
    orgId,
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
                      to: "/dashboard",
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
              title={`No activity · ${label}`}
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
                    to: "/dashboard",
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
                    to: "/dashboard",
                    search: { ...search, cursor: page.cursor ?? undefined },
                  })
                }
              >
                Next page
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Showing: {label}.{" "}
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
  const search = useSearch({ from: DASHBOARD_ROUTE })
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
                to: "/dashboard",
                search: { ...search, cursor: undefined },
              })
          : reset
      }
      retryLabel={cursorProblem ? "Back to the first page" : "Try again"}
    />
  )
}
