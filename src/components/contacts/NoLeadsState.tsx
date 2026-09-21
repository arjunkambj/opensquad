/**
 * The empty table, which is never just an empty table.
 *
 * An org with no contacts has a reason, and the reason is actionable:
 * the agent has not run yet, the run is still going, or the signals it ran
 * returned nothing — in which case this names them, with the matches each one
 * claimed, and links to where they can be changed. "No leads yet" on its own
 * would leave the user with nothing to do.
 *
 * The reason lives in two subscriptions that resolve after the list does, so
 * this waits for them rather than reading a missing run as "never started":
 * mid-run, that sentence would send a user back to setup they have finished.
 */
import { Link } from "@tanstack/react-router"
import { Target02Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { EmptyState } from "@/components/kit/EmptyState"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import type { RunState } from "./RunStateStrip"

type Signals = FunctionReturnType<typeof api.leads.counts.byStrategy>

export function NoLeadsState({
  run,
  signals,
  filtered,
  onClearFilters,
}: {
  /** The run this org last had, `null` for none — `undefined` while reading. */
  run: RunState | null | undefined
  /** `undefined` while reading. */
  signals: Signals | undefined
  /** True when a filter or search is narrowing the table. */
  filtered: boolean
  onClearFilters: () => void
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={UserGroupIcon}
        title="No contacts match this filter"
        description="Every contact is still here — this view is just narrower than the leads you have."
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
    return (
      <LoadingState
        title="Loading contacts"
        description="Reading what your agent has done so far."
      />
    )
  }

  if (run === null || run.status !== "live") {
    return (
      <EmptyState
        icon={Target02Icon}
        title="Your agent has not started yet"
        description="Finish setting the agent up — its ICP and its signals — and the first leads land here."
        action={
          <Button size="sm" render={<Link to="/agent" />}>
            Set up the agent
          </Button>
        }
      />
    )
  }

  if (run.running) {
    return (
      <EmptyState
        icon={Target02Icon}
        title="Finding your first leads…"
        description="The agent is searching your signals right now. Rows appear here as they land — nothing to do but wait."
      />
    )
  }

  const enabled = signals.filter((signal) => signal.enabled)
  const empty = enabled.filter((signal) => signal.leadsFound === 0)

  return (
    <EmptyState
      icon={Target02Icon}
      title={
        enabled.length === 0
          ? "No signals are switched on"
          : "Your signals returned nobody"
      }
      description={
        enabled.length === 0
          ? "A signal is a saved search the agent runs. Switch at least one on and the agent starts finding people."
          : "These searches ran and matched nobody worth storing. Widening the ICP — or the keywords behind a signal — is what changes that."
      }
      action={
        <div className="flex flex-col items-center gap-3">
          {empty.length === 0 ? null : (
            <ul className="flex flex-col gap-1 text-left text-xs text-muted-foreground">
              {empty.map((signal) => (
                <li key={signal.strategyId}>
                  <span className="text-foreground">{signal.title}</span> —{" "}
                  {signal.matchCount === 0
                    ? "no matches at all"
                    : `${signal.matchCount} claimed matches, none stored`}
                  {signal.exhausted ? " · free pages used up" : ""}
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" render={<Link to="/agent" />}>
            Edit signals and ICP
          </Button>
        </div>
      }
    />
  )
}
