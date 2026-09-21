/** All dashboard queries share one window resolved in the organization timezone. */
import { useUser } from "@hexclave/react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useMemo } from "react"
import { api } from "../../../convex/_generated/api"
import { ActivityChart } from "@/components/dashboard/ActivityChart"
import { DashboardPageSkeleton } from "@/components/dashboard/DashboardPageSkeleton"
import { DashboardRangePills } from "@/components/dashboard/DashboardRangePills"
import {
  DashboardStats,
  PipelineStat,
} from "@/components/dashboard/DashboardStats"
import { DashboardStatusChips } from "@/components/dashboard/DashboardStatusChips"
import { LatestReplies } from "@/components/dashboard/LatestReplies"
import { NextStepCard, type NextStep } from "@/components/dashboard/NextStepCard"
import {
  activePill,
  pillFilters,
  searchBounds,
  windowHint,
} from "@/components/dashboard/dashboard-range"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { useCurrentOrg } from "@/hooks/use-current-org"
import type { OrgView } from "@/lib/org-view"
import { withFilters } from "@/lib/search-params"

const DASHBOARD_ROUTE = "/_dashboard/_org/overview"

const PANEL_ROWS = 5

const NEXT_STEP_SHOWN: ReadonlySet<NextStep["kind"]> = new Set([
  "approve_leads",
  "start_sending",
  "enable_autopilot",
])

function firstName(displayName: string | null): string | null {
  const first = displayName?.trim().split(/\s+/)[0]
  return first === undefined || first.length === 0 ? null : first
}

export function DashboardPage() {
  const user = useUser()
  const current = useCurrentOrg()
  const name = firstName(user?.displayName ?? null)

  // Anything but `ready` cannot reach here — the `_org` gate sends a caller
  // with no organization row to setup — but loading is the only honest render
  // for a case that resolves elsewhere.
  if (current.status !== "ready") {
    return <DashboardPageSkeleton />
  }

  return (
    <DashboardBody org={current.org} name={name} />
  )
}

function DashboardBody({
  org,
  name,
}: {
  org: OrgView
  name: string | null
}) {
  const search = useSearch({ from: DASHBOARD_ROUTE })
  const navigate = useNavigate()
  const orgId = org._id
  const timezone = org.timezone

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
      hint: windowHint(active, resolved, timezone),
    }
  }, [search, timezone])
  const scope = { orgId, from: bounds.from, to: bounds.to }

  const summary = useQuery(api.dashboard.queries.summary, scope)
  const series = useQuery(api.dashboard.queries.activitySeries, scope)
  const replies = useQuery(api.dashboard.panels.latestReplies, {
    ...scope,
    limit: PANEL_ROWS,
  })
  const next = useQuery(api.dashboard.queries.nextStep, { orgId })
  const agent = useQuery(api.agents.queries.get, { orgId })
  const strategies = useQuery(api.leads.counts.byStrategy, { orgId })
  const updateAgent = useMutation(api.agents.settings.setDealSize)

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
            inboxConnection={org.inboxConnection}
          />
        }
      />

      <div className="flex justify-end">
        <DashboardRangePills
          active={pill}
          onSelect={(chosen) =>
            void navigate({
              to: "/overview",
              // A window change is a filter change, so the receipt feed's
              // cursor goes with it: page two of one window must never render
              // as page two of another.
              search: withFilters(search, pillFilters(chosen, timezone)),
            })
          }
        />
      </div>

      <DashboardStats summary={summary} hint={hint} />

      <ActivityChart series={series} hint={hint} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <PipelineStat
            className="flex-1"
            summary={summary}
            hint={hint}
            canEditDealSize={agentId !== undefined}
            onSaveDealSize={async (dealSize) => {
              if (agentId === undefined) {
                return
              }
              await updateAgent({ orgId, agentId, dealSize })
            }}
          />
          {/* Only steps that need a decision here; connecting the inbox
              belongs to the inbox. */}
          {next !== undefined && NEXT_STEP_SHOWN.has(next.kind) ? (
            <NextStepCard next={next} />
          ) : null}
        </div>
        <LatestReplies replies={replies} hint={hint} timezone={timezone} />
      </div>
    </div>
  )
}
