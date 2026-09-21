import { CatchBoundary, useNavigate, useSearch } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { actorLabel, formatInstant } from "@/lib/presentation"
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

/** Use the parent's bounds so activity and dashboard figures share the same window. */
export function ActivityFeed({
  orgId,
  timezone,
  bounds,
  hint,
}: {
  orgId: Id<"orgs">
  timezone: string
  bounds: { from: number; to: number }
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
        {/* Contain stale-cursor failures in the feed boundary. */}
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

/** Recover stale cursors by navigating to page one and remounting the boundary; retrying the cursor cannot succeed. */
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
