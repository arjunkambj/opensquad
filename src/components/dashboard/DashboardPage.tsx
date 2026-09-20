/**
 * `/dashboard` — reference 20: what the agent has done in a window you pick,
 * and the one thing waiting on a person.
 *
 * This is the container (PLAN §10): it owns every Convex call on the screen
 * and hands plain props down, so the panels below stay presentational and
 * know nothing about Convex.
 *
 * ONE WINDOW, ONE CLOCK. The range pills write the route's search params, and
 * every query on this page is given the same two instants, derived in the
 * WORKSPACE's zone. That is what makes the acceptance check possible: each
 * figure counts rows Contacts and the Inbox can be filtered to over the same
 * window (each query's doc comment in `convex/dashboard/model.ts` names its
 * rows exactly).
 *
 * A brand-new workspace reaches every panel's designed empty state. Nothing
 * here renders a zero that was not counted, and nothing renders sample rows.
 */
import { useUser } from "@hexclave/react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useMemo } from "react"
import { api } from "../../../convex/_generated/api"
import { ActivityChart } from "@/components/dashboard/ActivityChart"
import { ActivityFeed } from "@/components/dashboard/ActivityFeed"
import { DashboardRangePills } from "@/components/dashboard/DashboardRangePills"
import { DashboardStats } from "@/components/dashboard/DashboardStats"
import { DashboardStatusChips } from "@/components/dashboard/DashboardStatusChips"
import { LatestHotLeads } from "@/components/dashboard/LatestHotLeads"
import { LatestReplies } from "@/components/dashboard/LatestReplies"
import { NextStepCard } from "@/components/dashboard/NextStepCard"
import {
  activePill,
  pillFilters,
  searchBounds,
  windowHint,
} from "@/components/dashboard/dashboard-range"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { canEdit } from "@/lib/workspace-role"
import type { WorkspaceView } from "@/lib/workspace-view"
import type { WorkspaceRole } from "@/lib/workspace-role"
import { withFilters } from "@/lib/search-params"

const DASHBOARD_ROUTE = "/_dashboard/_workspace/dashboard"

/** How many rows each bottom panel lists before "View more". */
const PANEL_ROWS = 5

/** The greeting of reference 20 — the user's own name, or nobody's. */
function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0]
  return first === undefined || first.length === 0 ? null : first
}

export function DashboardPage() {
  const user = useUser()
  const current = useCurrentWorkspace()
  const name = firstName(user?.displayName ?? null)

  // `null` cannot reach here — the `_workspace` gate redirects a
  // membership-less user to setup — but loading is the only honest render for
  // a case that resolves elsewhere.
  if (current === undefined || current === null) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardPageTitle
          title={name === null ? "Welcome back" : `Welcome back, ${name}`}
        />
        <LoadingState
          title="Loading dashboard"
          description="Reading your workspace."
        />
      </div>
    )
  }

  return (
    <DashboardBody
      workspace={current.workspace}
      role={current.role}
      name={name}
    />
  )
}

function DashboardBody({
  workspace,
  role,
  name,
}: {
  workspace: WorkspaceView
  role: WorkspaceRole
  name: string | null
}) {
  const search = useSearch({ from: DASHBOARD_ROUTE })
  const navigate = useNavigate()
  const workspaceId = workspace._id
  const timezone = workspace.timezone

  // Day-granular, so the query arguments below are stable between renders and
  // the subscriptions are not torn down and rebuilt on every frame. Memoised
  // because resolving a window walks `Intl` a dozen times and every panel on
  // the page needs the same answer.
  const { bounds, hint, pill } = useMemo(() => {
    const resolved = searchBounds(search, timezone)
    const active = activePill(search, timezone)
    return {
      bounds: resolved,
      pill: active,
      hint: windowHint(active, resolved),
    }
  }, [search, timezone])
  const scope = { workspaceId, from: bounds.from, to: bounds.to }

  const summary = useQuery(api.dashboard.queries.summary, scope)
  const series = useQuery(api.dashboard.queries.activitySeries, scope)
  const hotLeads = useQuery(api.dashboard.panels.latestHotLeads, {
    ...scope,
    limit: PANEL_ROWS,
  })
  const replies = useQuery(api.dashboard.panels.latestReplies, {
    ...scope,
    limit: PANEL_ROWS,
  })
  const next = useQuery(api.dashboard.queries.nextStep, { workspaceId })
  const agent = useQuery(api.agents.queries.get, { workspaceId })
  const strategies = useQuery(api.leads.counts.byStrategy, { workspaceId })
  const updateAgent = useMutation(api.agents.mutations.updateBasics)

  const agentId = agent?._id
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title={name === null ? "Welcome back" : `Welcome back, ${name}`}
        description="What your agent has been doing, in the window you pick."
        actions={
          <DashboardStatusChips
            activeSignals={
              strategies === undefined
                ? undefined
                : strategies.filter((strategy) => strategy.enabled).length
            }
            inboxConnection={workspace.inboxConnection}
          />
        }
      />

      <div className="flex justify-end">
        <DashboardRangePills
          active={pill}
          onSelect={(chosen) =>
            void navigate({
              to: "/dashboard",
              // A window change is a filter change, so the receipt feed's
              // cursor goes with it: page two of one window must never render
              // as page two of another.
              search: withFilters(search, pillFilters(chosen, timezone)),
            })
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-full sm:col-span-2 lg:col-span-1">
          <NextStepCard next={next} />
        </div>
        <DashboardStats
          summary={summary}
          hint={hint}
          canEditDealSize={canEdit(role) && agentId !== undefined}
          onSaveDealSize={async (dealSize) => {
            if (agentId === undefined) {
              return
            }
            await updateAgent({ workspaceId, agentId, dealSize })
          }}
        />
      </div>

      <ActivityChart series={series} hint={hint} />

      <div className="grid gap-4 lg:grid-cols-2">
        <LatestHotLeads leads={hotLeads} hint={hint} />
        <LatestReplies replies={replies} hint={hint} timezone={timezone} />
      </div>

      <ActivityFeed
        workspaceId={workspaceId}
        timezone={timezone}
        bounds={bounds}
        hint={hint}
      />
    </div>
  )
}
