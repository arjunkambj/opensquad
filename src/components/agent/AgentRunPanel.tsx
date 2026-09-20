/**
 * "Run now", and what the run loop is doing (PLAN §9.1).
 *
 * Every word here is a stored fact: `running` is the run LEASE being live,
 * not merely present, and the last and next times are the agent's own
 * `lastRunAt` / `nextRunAt`. Nothing is predicted — a run that has no due
 * time says so rather than inventing one.
 *
 * The button is the public half of the single-flight door: a second click
 * while a run holds the lease is answered "already running" instead of
 * starting a second one, and the per-user rate limit refuses a burst.
 */
import { PlayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatInstant, formatWaited } from "@/components/shared/presentation"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { RunState } from "./agent-model"
import { agentErrorCopy, RUN_NOW_COPY } from "./agent-model"

export function AgentRunPanel({
  workspaceId,
  agentId,
  timezone,
  runState,
  canEdit,
}: {
  workspaceId: Id<"workspaces">
  agentId: Id<"agents">
  timezone: string
  runState: RunState | undefined
  canEdit: boolean
}) {
  const runNow = useMutation(api.agents.settingsRun.runNow)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const running = runState?.running === true

  const start = async () => {
    setRequesting(true)
    setError(null)
    try {
      const result = await runNow({ workspaceId, agentId })
      if (result.started) {
        toast.add({ title: RUN_NOW_COPY.started, type: "success" })
      } else {
        // "Already running" is the honest answer to a second click, not a
        // failure — it is shown, not swallowed.
        setError(RUN_NOW_COPY[result.reason])
      }
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not start a run."))
    } finally {
      setRequesting(false)
    }
  }

  const status = () => {
    if (runState === undefined) {
      return "Reading the agent's run state…"
    }
    if (running) {
      return runState.startedAt === undefined
        ? "Running now."
        : `Running now — started ${formatWaited(runState.startedAt)}.`
    }
    const last =
      runState.lastRunAt === undefined
        ? "It has not run yet."
        : `Last run ${formatWaited(runState.lastRunAt)}.`
    const next =
      runState.nextRunAt === undefined
        ? runState.status === "live"
          ? " No next run is scheduled — start one here."
          : " It starts running once setup is finished."
        : ` Next run ${formatInstant(runState.nextRunAt, timezone)}.`
    return `${last}${next}`
  }

  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-foreground">{status()}</p>
          {runState !== undefined && runState.needsAttention.count > 0 ? (
            <p className="text-xs text-muted-foreground">
              {runState.needsAttention.count} lead
              {runState.needsAttention.count === 1 ? "" : "s"} need you below.
            </p>
          ) : null}
          <FormError message={error} />
        </div>
        {canEdit ? (
          <Button
            size="sm"
            disabled={requesting || running || runState === undefined}
            onClick={() => void start()}
          >
            {requesting ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <HugeiconsIcon
                icon={PlayIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
            )}
            Run now
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
