/** Wait for run and signal subscriptions before explaining an empty list; missing data is not a never-run agent. */
import { Link } from "@tanstack/react-router"
import { Target02Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import type { OperationErrorCode } from "../../../convex/lib/validators"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { isLeadDiscoveryPending, LeadDiscoveryProgress } from "./LeadDiscoveryProgress"
import { LeadsResultsSkeleton } from "./LeadsPageSkeleton"
import type { RunState } from "./RunStateStrip"

type Signals = FunctionReturnType<typeof api.leads.counts.byStrategy>

export function NoLeadsState({
  run,
  signals,
  filtered,
  onClearFilters,
}: {
  run: RunState | null | undefined
  signals: Signals | undefined
  filtered: boolean
  onClearFilters: () => void
}) {
  if (filtered) {
    return (
      <EmptyState
        variant="plain"
        icon={UserGroupIcon}
        title="No leads match this filter"
        description="Every lead is still here — this view is just narrower."
        action={
          <Button size="sm" variant="outline" onClick={onClearFilters}>
            Clear the filter
          </Button>
        }
      />
    )
  }

  // A filter can be answered without either of them; nothing below can.
  if (run === undefined || signals === undefined) {
    return <NoLeadsSkeleton />
  }

  if (run === null || run.status !== "live") {
    return (
      <EmptyState
        variant="plain"
        icon={Target02Icon}
        title="Your agent has not started yet"
        description="Finish setting the agent up — its ICP and its signals — and the first leads land here."
        action={
          <Button size="sm" render={<Link to="/signals" />}>
            Set up the agent
          </Button>
        }
      />
    )
  }

  const enabled = signals.filter((signal) => signal.enabled)
  const empty = enabled.filter((signal) => signal.leadsFound === 0)
  const searched = enabled.some((signal) => signal.lastRunAt !== undefined)
  if (isLeadDiscoveryPending(run, signals)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <LeadDiscoveryProgress running={run.running} />
        <div aria-hidden="true">
          <LeadsResultsSkeleton />
        </div>
      </div>
    )
  }

  return (
    <EmptyState
      variant="plain"
      icon={Target02Icon}
      title={
        enabled.length === 0
          ? "No signals are switched on"
          : searched
            ? "Your signals returned nobody"
            : "Your agent has not searched yet"
      }
      description={
        enabled.length === 0
          ? "A signal is a saved search the agent runs. Switch at least one on and the agent starts finding people."
          : searched
            ? "These searches ran and stored nobody. Widening the ICP — or the keywords behind a signal — is what changes that."
            : "Your signals have matches, but no search has run for them yet. Leads land here after the agent's next run."
      }
      action={
        <div className="flex w-md max-w-full flex-col items-center gap-3">
          {empty.length === 0 ? null : (
            <ul className="flex w-full flex-col gap-2 text-left text-xs">
              {empty.map((signal) => (
                <li key={signal.strategyId} className="flex flex-col">
                  <span className="truncate text-foreground">
                    {signal.title}
                  </span>
                  <span className="text-muted-foreground">
                    {signalOutcome(signal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" render={<Link to="/signals" />}>
            Edit signals and ICP
          </Button>
        </div>
      }
    />
  )
}

/**
 * An empty page reached by a cursor: a deep link past the end, or rows that
 * left this list after the link was made. Nothing below explains it, and
 * without a way back the footer is gone too — so this offers the only exit.
 */
export function StalePageState({ onReset }: { onReset: () => void }) {
  return (
    <EmptyState
      variant="plain"
      icon={UserGroupIcon}
      title="Nothing on this page"
      description="These rows have moved on since this link was made."
      action={
        <Button size="sm" variant="outline" onClick={onReset}>
          Back to the first page
        </Button>
      }
    />
  )
}

const PARKED_COPY: Partial<Record<OperationErrorCode, string>> = {
  rate_limited: "paused: the search kept being throttled",
  insufficient_credits: "paused: not enough credits to search",
  platform_paused: "paused: searching is paused right now",
  invalid_response: "paused: its filters could not be searched",
}

function signalOutcome(signal: Signals[number]): string {
  if (signal.parkedReason !== undefined) {
    return `${PARKED_COPY[signal.parkedReason] ?? "paused: the search failed"}. Switch it off and on to retry.`
  }
  if (signal.matchCount === 0) {
    return "no matches at all"
  }
  const matches = `${signal.matchCountIsApproximate ? "about " : ""}${signal.matchCount.toLocaleString()} ${signal.matchCount === 1 ? "match" : "matches"}`
  if (signal.lastRunAt === undefined) {
    return `${matches}, not searched yet`
  }
  return `${matches}, none stored${signal.exhausted ? " · free pages used up" : ""}`
}

/** Mirrors the plain `EmptyState` the answer lands in: mark, title, two lines, a button. */
function NoLeadsSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col items-center justify-center gap-3 px-6 py-14"
    >
      <span className="sr-only">Reading what your agent has done so far</span>
      <Skeleton shape="xl" className="size-9" />
      <Skeleton shape="full" className="h-4 w-48" />
      <div className="flex w-full max-w-md flex-col items-center gap-2">
        <Skeleton shape="full" className="h-3.5 w-full" />
        <Skeleton shape="full" className="h-3.5 w-3/5" />
      </div>
      <Skeleton shape="xl" className="mt-2 h-7 w-32" />
    </div>
  )
}
