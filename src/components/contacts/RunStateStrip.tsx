/**
 * What the agent is doing, above the table.
 *
 * The honest version of "Finding your first leads…": `running` is the run
 * lease being LIVE, not merely present, so this strip disappears the moment
 * nothing is actually working — and the counts beside it are the rows the run
 * has produced so far, which is why the table fills in underneath while it is
 * shown.
 */
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { formatWaited } from "@/components/shared/presentation"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { boundedCount } from "@/lib/bounded-count"

export type RunState = NonNullable<
  FunctionReturnType<typeof api.leads.counts.runState>
>

export function RunStateStrip({
  run,
  onShowNeedsAttention,
}: {
  run: RunState
  onShowNeedsAttention: () => void
}) {
  const needsAttention = run.needsAttention.count > 0

  if (!run.running && !needsAttention) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      {run.running ? (
        <div className="flex items-center gap-2.5">
          <Spinner className="size-4 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {run.researched.count === 0
                ? "Finding your first leads…"
                : "Your agent is working"}
            </p>
            <p className="text-xs text-muted-foreground">
              {boundedCount(run.found.count, run.found.hasMore)} waiting to be
              researched ·{" "}
              {boundedCount(run.researched.count, run.researched.hasMore)} scored
              so far. Rows appear here as they land.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-4 text-destructive"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              {boundedCount(
                run.needsAttention.count,
                run.needsAttention.hasMore,
              )}{" "}
              leads need you
            </p>
            <p className="text-xs text-muted-foreground">
              A step kept failing for these. Open one to see why and retry it.
              {run.lastRunAt === undefined
                ? ""
                : ` Last run ${formatWaited(run.lastRunAt)}.`}
            </p>
          </div>
        </div>
      )}

      {needsAttention ? (
        <Button size="sm" variant="outline" onClick={onShowNeedsAttention}>
          Show them
        </Button>
      ) : null}
    </div>
  )
}
