import { useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type { BoardColumn } from "../../../convex/lib/validators"
import { MissionCard } from "@/components/missions/MissionCard"
import { useMissionFocus } from "@/components/missions/mission-focus"
import { BOARD_COLUMN_META } from "@/components/missions/mission-presentation"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { boundedCount } from "@/lib/bounded-count"
import { withFilters } from "@/lib/search-params"

const OVERVIEW_ROUTE = "/_dashboard/_workspace/overview"

/**
 * `DEFAULT_LIST_LIMIT`. Not 50: `listBoard` returns the whole mission document
 * including the frozen `inputSnapshot`, which is bounded only at 64 KiB, so
 * four columns × 50 rows is a worst case measured in megabytes the card never
 * renders. `25+` from a 25-row page is honest; a hard-coded `50+` from a
 * 25-row page is not.
 *
 * `boundedLimit` THROWS outside [1, 50] rather than clamping, so this is a
 * literal and never a number computed from a container height.
 */
const BOARD_PAGE_SIZE = 25

export type ColumnDisplay = "cards" | "count"

/**
 * One board column: its own `missions.listBoard` query, its own bounded count,
 * and its own three empty states.
 *
 * Paging is **local**, never in the URL. Four opaque cursors would make a
 * board link unshareable, and a shared board link has to show current truth
 * rather than a frozen page (`plan/ux.md` §6). The parent keys this component
 * on its filter set, so changing a filter remounts it and the local cursor is
 * dropped without an effect — and so is the cursor when the operator opens a
 * mission and comes back, which is what you want.
 *
 * `display: "count"` renders the same query as a selector entry, so the counts
 * stay visible for all four columns even when three of them are behind the
 * selector.
 */
export function MissionColumn({
  workspaceId,
  column,
  campaignId,
  archived,
  display,
  expanded,
  active = false,
  viewKey,
  ownerNames,
  ownersLoading,
}: {
  workspaceId: Id<"workspaces">
  column: BoardColumn
  campaignId: Id<"campaigns"> | undefined
  archived: boolean
  display: ColumnDisplay
  expanded: boolean
  active?: boolean
  /** The board's current view, which scopes focus restore. */
  viewKey: string
  ownerNames: Map<string, string>
  ownersLoading: boolean
}) {
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const navigate = useNavigate()
  const { drop } = useMissionFocus()

  // `index` is what the header shows once the operator has paged: a count
  // taken from page two counts page two, so it stops being a count.
  const [page, setPage] = useState<{ cursor?: string; index: number }>({
    index: 1,
  })

  // Paging is the operator placing focus on a pager control. The card they
  // opened before may well be on the page that arrives; restoring focus to it
  // would take focus off the button they just pressed, so the memory is
  // dropped rather than carried across a page they asked for.
  const showFirstPage = () => {
    drop()
    setPage({ index: 1 })
  }
  const showNextPage = (cursor: string) => {
    drop()
    setPage((previous) => ({ cursor, index: previous.index + 1 }))
  }

  const result = useQuery(api.missions.listBoard, {
    workspaceId,
    column,
    limit: BOARD_PAGE_SIZE,
    ...(campaignId === undefined ? {} : { campaignId }),
    ...(archived ? { visibility: "archived" as const } : {}),
    ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
  })

  const meta = BOARD_COLUMN_META[column]

  // A loading column shows an em dash, never `0` — a zero would read as a
  // finished, empty column, which is the exact confusion V11 tests for.
  const count =
    result === undefined
      ? "—"
      : page.index > 1
        ? `page ${page.index}`
        : boundedCount(result.items.length, result.hasMore)

  if (display === "count") {
    return (
      <Button
        variant={active ? "secondary" : "ghost"}
        size="sm"
        aria-current={active ? "true" : undefined}
        onClick={() =>
          void navigate({
            to: "/overview",
            search: withFilters(search, { column }),
          })
        }
      >
        {meta.label}
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      </Button>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-heading text-base font-medium text-foreground">
            {meta.label}
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {count}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {meta.subtitle}
        </p>
      </header>

      <div
        className={
          expanded
            ? "flex flex-col gap-2"
            : "flex max-h-[32rem] flex-col gap-2 overflow-y-auto"
        }
      >
        {result === undefined ? (
          <LoadingState
            title={`Loading ${meta.label}`}
            description="Reading this column."
            className="py-8"
          />
        ) : result.items.length === 0 ? (
          <ColumnEmpty
            column={column}
            archived={archived}
            paged={page.index > 1}
            filteredToCampaign={search.campaign !== undefined}
            onFirstPage={showFirstPage}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {result.items.map((mission) => (
              <li key={mission._id}>
                <MissionCard
                  mission={mission}
                  viewKey={viewKey}
                  ownerName={ownerNames.get(mission.assignedEmployeeId)}
                  ownersLoading={ownersLoading}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {result === undefined ? null : expanded ? (
        <ColumnPager
          hasMore={result.hasMore}
          cursor={result.cursor}
          onFirstPage={page.index === 1 ? undefined : showFirstPage}
          onNextPage={showNextPage}
        />
      ) : result.hasMore ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void navigate({
                to: "/overview",
                search: withFilters(search, { column }),
              })
            }
          >
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Distinct empties, in the contract's order: an empty page behind a cursor
 * says nothing about the column, a filter-empty names **every** filter
 * responsible and offers to clear each of them, and only an unfiltered first
 * page may claim the true empty — whose job is to say what will put a card
 * here.
 *
 * The two filters compose rather than compete. Archive and campaign can both
 * be on, and the branch that fires first must not wear the other's words:
 * "Nothing archived in Backlog" while a campaign filter is what produced the
 * zero is the filtered-to-zero state posing as the true empty, and its single
 * "Back to the board" escape leaves the campaign filter on — moving the
 * operator further from what they were looking for.
 */
function ColumnEmpty({
  column,
  archived,
  paged,
  filteredToCampaign,
  onFirstPage,
}: {
  column: BoardColumn
  archived: boolean
  paged: boolean
  filteredToCampaign: boolean
  onFirstPage: () => void
}) {
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const navigate = useNavigate()
  const meta = BOARD_COLUMN_META[column]

  if (paged) {
    return (
      <EmptyState
        title="Nothing further in this column"
        description="There is nothing on this page. Missions may still be waiting on the first page."
        action={
          <Button variant="outline" size="sm" onClick={onFirstPage}>
            Back to the first page
          </Button>
        }
        className="py-8"
      />
    )
  }

  const showAllCampaigns = (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void navigate({
          to: "/overview",
          search: withFilters(search, { campaign: undefined }),
        })
      }
    >
      Show all campaigns
    </Button>
  )

  const backToTheBoard = (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        void navigate({
          to: "/overview",
          search: withFilters(search, { archived: undefined }),
        })
      }
    >
      Back to the board
    </Button>
  )

  if (archived && filteredToCampaign) {
    return (
      <EmptyState
        title={`Nothing archived in ${meta.label} for this campaign`}
        description="Two filters are on: the archive, and one campaign. Another campaign may still have archived missions in this column, and the board itself is a separate view."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {showAllCampaigns}
            {backToTheBoard}
          </div>
        }
        className="py-8"
      />
    )
  }

  if (archived) {
    return (
      <EmptyState
        title={`Nothing archived in ${meta.label}`}
        description="This is the archive, not the board. Archived missions keep their column."
        action={backToTheBoard}
        className="py-8"
      />
    )
  }

  if (filteredToCampaign) {
    return (
      <EmptyState
        title={`Nothing in ${meta.label} for this campaign`}
        description="This column is filtered to one campaign. Other campaigns may still have missions here."
        action={showAllCampaigns}
        className="py-8"
      />
    )
  }

  return (
    <EmptyState
      title={meta.emptyTitle}
      description={meta.emptyDescription}
      className="py-8"
    />
  )
}

/** Forward-only local paging inside the expanded single-column view. */
function ColumnPager({
  hasMore,
  cursor,
  onFirstPage,
  onNextPage,
}: {
  hasMore: boolean
  cursor: string | null
  onFirstPage?: () => void
  onNextPage: (cursor: string) => void
}) {
  if (onFirstPage === undefined && !hasMore) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onFirstPage === undefined ? null : (
        <Button variant="outline" size="sm" onClick={onFirstPage}>
          Back to the first page
        </Button>
      )}
      {hasMore && cursor !== null ? (
        <Button variant="outline" size="sm" onClick={() => onNextPage(cursor)}>
          Next page
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {hasMore
          ? "More missions than fit on one page."
          : "End of this column."}
      </p>
    </div>
  )
}
