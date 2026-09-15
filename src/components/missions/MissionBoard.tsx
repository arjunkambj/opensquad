import { useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { MissionColumn } from "@/components/missions/MissionColumn"
import { NewMissionDialog } from "@/components/missions/NewMissionDialog"
import { RuntimeBadge } from "@/components/overview/RuntimeBadge"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useIsMobile } from "@/hooks/use-mobile"
import { withFilters } from "@/lib/search-params"
import {
  BOARD_COLUMNS,
  type BoardColumn,
} from "@/routes/_dashboard/_workspace/overview"

const OVERVIEW_ROUTE = "/_dashboard/_workspace/overview"

/**
 * At phone width the board is a column selector rather than four columns:
 * four columns at 375px is 90px each, which clips a card's status line, and
 * clipped text fails V10. The four columns never collapse to fewer than four
 * states at any width — the selector keeps all four names and all four counts
 * visible, only the cards go behind it.
 */
const PHONE_DEFAULT_COLUMN: BoardColumn = "needs_you"

/**
 * `MAX_LIST_LIMIT`. `boundedLimit` THROWS outside [1, 50] rather than
 * clamping, so this is a literal. Campaign rows carry no frozen snapshot, so
 * unlike the board there is no payload reason to ask for fewer — and the
 * question being asked ("can a mission be started at all?") deserves the
 * widest answer the backend will give.
 */
const ACTIVE_CAMPAIGN_LIMIT = 50

/**
 * The four-column board.
 *
 * One `missions.listBoard` query per column, one `employees.list` for every
 * owner name on the board, and one `campaigns.list` for the filter. Nothing
 * here computes a card's column: `boardColumn` is a stored field three backend
 * writers keep in sync, so the UI renders whatever column returned a card.
 *
 * The date picker is deliberately NOT attached to this. `listBoard` takes no
 * date arguments and physically cannot be date-filtered, and hiding an old
 * unfinished mission behind a date range is the exact defect
 * `plan/architecture.md` §5 names. The picker belongs to the activity feed.
 */
export function MissionBoard() {
  const current = useCurrentWorkspace()
  const search = useSearch({ from: OVERVIEW_ROUTE })
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const workspaceId =
    current !== undefined && current !== null ? current.workspace._id : undefined

  const campaigns = useQuery(
    api.campaigns.list,
    workspaceId === undefined ? "skip" : { workspaceId },
  )
  // Eligibility is asked of the server rather than derived from the dropdown's
  // page. `campaigns.list` above is unfiltered and bounded at 25, so a
  // workspace with 26+ campaigns could hide the one confirmed campaign that
  // `missions.create` would have accepted — and post-filtering a truncated
  // page and presenting the result as a filtered answer is what
  // `plan/ux.md` §6 forbids outright. `status` is a real argument; use it.
  const activeCampaigns = useQuery(
    api.campaigns.list,
    workspaceId === undefined
      ? "skip"
      : { workspaceId, status: "active" as const, limit: ACTIVE_CAMPAIGN_LIMIT },
  )
  const employees = useQuery(
    api.employees.list,
    workspaceId === undefined ? "skip" : { workspaceId },
  )

  // `null` cannot reach here — the `_workspace` gate redirects a
  // membership-less user to setup — but loading is the only honest render for
  // a case that resolves elsewhere.
  if (current === undefined || current === null) {
    return (
      <LoadingState
        title="Loading Mission Control"
        description="Reading your workspace."
      />
    )
  }

  const ownerNames = new Map<string, string>(
    (employees ?? []).map((employee) => [employee._id, employee.name]),
  )
  const archived = search.archived ?? false
  const campaignId =
    search.campaign === undefined
      ? undefined
      : (search.campaign as Id<"campaigns">)

  // `listBoard` does not validate `campaignId` — a hand-edited or stale
  // `?campaign=` returns an empty page silently rather than NOT_FOUND. Saying
  // so beats four mystery empties and an unselected dropdown.
  const campaignUnknown =
    search.campaign !== undefined &&
    campaigns !== undefined &&
    !campaigns.items.some((campaign) => campaign._id === search.campaign)

  const singleColumn = isMobile || search.column !== undefined
  const activeColumn: BoardColumn = search.column ?? PHONE_DEFAULT_COLUMN

  // Remounting on a filter change is what drops a column's local page cursor
  // without an effect — page two of one filter must never render as page two
  // of a different one.
  const filterKey = `${search.campaign ?? ""}:${archived}`

  const shared = {
    workspaceId: current.workspace._id,
    campaignId,
    archived,
    ownerNames,
    ownersLoading: employees === undefined,
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Above the controls, because whether anything can run at all outranks
          how the board is filtered. */}
      <RuntimeBadge workspaceId={current.workspace._id} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="board-campaign">Campaign</Label>
          <NativeSelect
            id="board-campaign"
            className="w-56"
            value={search.campaign ?? ""}
            disabled={campaigns === undefined}
            onChange={(event) =>
              void navigate({
                to: "/overview",
                search: withFilters(search, {
                  campaign:
                    event.target.value === "" ? undefined : event.target.value,
                }),
              })
            }
          >
            <option value="">All campaigns</option>
            {(campaigns?.items ?? []).map((campaign) => (
              <option key={campaign._id} value={campaign._id}>
                {campaign.title}
              </option>
            ))}
          </NativeSelect>
        </div>

        <Button
          variant={archived ? "secondary" : "outline"}
          size="sm"
          aria-pressed={archived}
          onClick={() =>
            void navigate({
              to: "/overview",
              search: withFilters(search, {
                archived: archived ? undefined : true,
              }),
            })
          }
        >
          {archived ? "Showing the archive" : "Show the archive"}
        </Button>

        {search.column === undefined ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigate({
                to: "/overview",
                search: withFilters(search, { column: undefined }),
              })
            }
          >
            Show all four columns
          </Button>
        )}

        <div className="ml-auto">
          <NewMissionDialog
            workspaceId={current.workspace._id}
            role={current.role}
            activeCampaigns={activeCampaigns?.items ?? []}
            activeCampaignsLoading={activeCampaigns === undefined}
            activeCampaignsTruncated={activeCampaigns?.hasMore ?? false}
          />
        </div>
      </div>

      {archived ? (
        <p className="text-sm text-muted-foreground">
          This is the archive, not the board. Archiving changes visibility only
          — it never means the work succeeded.
        </p>
      ) : null}

      {campaigns !== undefined && campaigns.hasMore ? (
        <p className="text-xs text-muted-foreground">
          More campaigns than fit in this list. The first{" "}
          {campaigns.items.length} are shown.
        </p>
      ) : null}

      {campaignUnknown ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Filtered to a campaign that is not in this list. The board is empty
            because nothing matches it, not because there is no work.
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void navigate({
                to: "/overview",
                search: withFilters(search, { campaign: undefined }),
              })
            }
          >
            Show all campaigns
          </Button>
        </div>
      ) : null}

      {singleColumn ? (
        <div className="flex flex-col gap-4">
          <div
            role="group"
            aria-label="Board columns"
            className="flex flex-wrap items-center gap-1"
          >
            {BOARD_COLUMNS.map((column) => (
              <MissionColumn
                key={`count:${column}:${filterKey}`}
                {...shared}
                column={column}
                display="count"
                expanded={false}
                active={column === activeColumn}
              />
            ))}
          </div>
          <MissionColumn
            key={`cards:${activeColumn}:${filterKey}`}
            {...shared}
            column={activeColumn}
            display="cards"
            expanded
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {BOARD_COLUMNS.map((column) => (
            <MissionColumn
              key={`cards:${column}:${filterKey}`}
              {...shared}
              column={column}
              display="cards"
              expanded={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}
