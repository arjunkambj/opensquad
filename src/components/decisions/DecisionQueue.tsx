import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import {
  KindChip,
  RequiredChip,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { withFilters } from "@/lib/search-params"

const QUEUE_ROUTE = "/_dashboard/_workspace/decisions"

/**
 * The one shared queue of everything needing a human.
 *
 * Grouped by mission, because an ask without its mission is an ask without a
 * reason — but the grouping is the only structure imposed. There are no
 * sub-tickets (`decisionFields` has no parent pointer), no kind filter and no
 * resolved tab; see the route file for why the last two cannot exist yet.
 *
 * Every row is a link, so the queue is workable with Tab and Enter alone.
 */
export function DecisionQueue() {
  const current = useCurrentWorkspace()
  const search = useSearch({ from: QUEUE_ROUTE })
  const navigate = useNavigate()

  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined

  const page = useQuery(
    api.decisions.listOpen,
    workspaceId === undefined
      ? "skip"
      : {
          workspaceId,
          ...(search.mission === undefined
            ? {}
            : { missionId: search.mission as Id<"missions"> }),
          ...(search.cursor === undefined ? {} : { cursor: search.cursor }),
        },
  )

  // `null` cannot reach here — `_workspace` redirects a membership-less user
  // to setup — but the query types as nullable and loading is the only honest
  // render for a case that resolves elsewhere.
  if (current === undefined || current === null || page === undefined) {
    return (
      <LoadingState
        title="Loading decisions"
        description="Reading everything that is waiting on a human."
      />
    )
  }

  if (page.items.length === 0) {
    // Three distinct empties. "Nothing is waiting" is the good outcome of this
    // screen and the one sentence here that has to be trustworthy, so it may be
    // claimed ONLY from an unfiltered first page. An empty page behind a cursor
    // says nothing about the workspace — a colleague resolving the last ask on
    // page two, or a stale pasted link, both land here while page one is full.
    if (search.cursor !== undefined) {
      return (
        <EmptyState
          title="Nothing further on this page"
          description="This is a link to a later page of the queue, and there is nothing on it. Open decisions may still be waiting on the first page."
          action={
            <Button
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/decisions",
                  search: { ...search, cursor: undefined },
                })
              }
            >
              Back to the first page
            </Button>
          }
        />
      )
    }
    if (search.mission !== undefined) {
      return (
        <EmptyState
          title="Nothing open for this mission"
          description="This queue is filtered to one mission and that mission has no open decisions. Other missions may still be waiting on you."
          action={
            <Button
              variant="outline"
              onClick={() =>
                void navigate({
                  to: "/decisions",
                  search: withFilters(search, { mission: undefined }),
                })
              }
            >
              Show all missions
            </Button>
          }
        />
      )
    }
    return (
      <EmptyState
        title="Nothing is waiting on you"
        description="The squad puts an ask here when it needs a decision — an email to approve before it is sent, a fact it could not find, or a delivery whose outcome it cannot determine. Start or open a mission and the first approval will land here."
        action={<Button render={<Link to="/overview" />}>Go to Overview</Button>}
      />
    )
  }

  const groups = groupByMission(page.items)

  return (
    <div className="flex flex-col gap-6">
      {search.mission === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Filtered to one mission.</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void navigate({
                to: "/decisions",
                search: withFilters(search, { mission: undefined }),
              })
            }
          >
            Show all missions
          </Button>
        </div>
      )}

      {groups.map((group) => (
        <MissionGroup
          key={group.missionId}
          workspaceId={current.workspace._id}
          missionId={group.missionId}
          decisions={group.decisions}
          filtered={search.mission !== undefined}
          onFilterToMission={() =>
            void navigate({
              to: "/decisions",
              search: withFilters(search, { mission: group.missionId }),
            })
          }
        />
      ))}

      <QueuePager
        hasMore={page.hasMore}
        cursor={page.cursor}
        onFirstPage={
          search.cursor === undefined
            ? undefined
            : () =>
                void navigate({
                  to: "/decisions",
                  search: { ...search, cursor: undefined },
                })
        }
        onNextPage={
          page.cursor === null
            ? undefined
            : (cursor) =>
                void navigate({
                  to: "/decisions",
                  search: { ...search, cursor },
                })
        }
      />
    </div>
  )
}

type MissionGroupItems = {
  missionId: Id<"missions">
  decisions: Doc<"decisions">[]
}

/**
 * Group in arrival order rather than sorting, so the newest-first ordering the
 * workspace-wide query guarantees survives the grouping.
 */
function groupByMission(items: Doc<"decisions">[]): MissionGroupItems[] {
  const groups: MissionGroupItems[] = []
  for (const decision of items) {
    const existing = groups.find(
      (group) => group.missionId === decision.missionId,
    )
    if (existing === undefined) {
      groups.push({ missionId: decision.missionId, decisions: [decision] })
    } else {
      existing.decisions.push(decision)
    }
  }
  return groups
}

/**
 * One mission's asks. The header reads the mission itself rather than deriving
 * a count from the page: `mission.requiredDecisionCount` is a stored field the
 * backend maintains, so it is exact and does not change meaning at a
 * pagination boundary the way a count of visible rows would.
 */
function MissionGroup({
  workspaceId,
  missionId,
  decisions,
  filtered,
  onFilterToMission,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
  decisions: Doc<"decisions">[]
  filtered: boolean
  onFilterToMission: () => void
}) {
  const detail = useQuery(api.missions.get, { workspaceId, missionId })

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-heading text-base font-medium text-foreground">
            {detail === undefined ? "Loading mission…" : detail.mission.title}
          </h2>
          {detail === undefined ? null : (
            <p className="text-xs text-muted-foreground">
              {detail.mission.state} · {detail.mission.priority} priority ·{" "}
              {detail.mission.requiredDecisionCount === 0
                ? "no required asks"
                : `${detail.mission.requiredDecisionCount} required ${
                    detail.mission.requiredDecisionCount === 1 ? "ask" : "asks"
                  } open`}
            </p>
          )}
        </div>
        {filtered ? null : (
          <Button variant="ghost" size="xs" onClick={onFilterToMission}>
            Only this mission
          </Button>
        )}
      </header>

      <ul className="flex flex-col gap-2">
        {decisions.map((decision) => (
          <li key={decision._id}>
            <DecisionRow decision={decision} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The whole row is the link. `search: (prev) => prev` carries the mission
 * filter and the page cursor into the detail route, which is what lets "back
 * to the queue" return to the page the reviewer was actually on.
 */
function DecisionRow({ decision }: { decision: Doc<"decisions"> }) {
  return (
    <Link
      to="/decisions/$decisionId"
      params={{ decisionId: decision._id }}
      search={(previous) => previous}
      className="flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-card px-4 py-3 text-card-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind={decision.kind} />
        <RequiredChip required={decision.required} />
        <span className="text-xs text-muted-foreground">
          waited {formatWaited(decision.createdAt)}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground">
        {decision.reason}
      </p>
    </Link>
  )
}

/**
 * Cursor paging, forward only. The cursor lives in the URL because a queue
 * position is shared context (V13 works the same draft in two sessions), and
 * Back is the way to the previous page — the browser already keeps that stack,
 * and Convex cursors do not run backwards.
 */
function QueuePager({
  hasMore,
  cursor,
  onFirstPage,
  onNextPage,
}: {
  hasMore: boolean
  cursor: string | null
  onFirstPage?: () => void
  onNextPage?: (cursor: string) => void
}) {
  if (onFirstPage === undefined && !hasMore) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onFirstPage === undefined ? null : (
        <Button variant="outline" size="sm" onClick={onFirstPage}>
          First page
        </Button>
      )}
      {hasMore && cursor !== null && onNextPage !== undefined ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNextPage(cursor)}
        >
          Next page
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {hasMore
          ? "More open decisions than fit on one page."
          : "End of the queue."}
      </p>
    </div>
  )
}
