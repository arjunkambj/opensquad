import { PlayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatInstant, formatWaited } from "@/lib/presentation"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import type { RunState } from "./agent-model"
import { agentErrorCopy, RUN_NOW_COPY } from "./agent-model"

export function AgentRunPanel({
  orgId,
  agentId,
  timezone,
  runState,
  now,
}: {
  orgId: Id<"orgs">
  agentId: Id<"agents">
  timezone: string
  runState: RunState | undefined
  /** The page's shared clock, so "last run" ages without a render-time `Date.now()`. */
  now: number
}) {
  const runNow = useMutation(api.agents.settingsRun.runNow)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const running = runState?.running === true

  const start = async () => {
    setRequesting(true)
    setError(null)
    try {
      const result = await runNow({ orgId, agentId })
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

  const status = (state: RunState) => {
    if (running) {
      return state.startedAt === undefined
        ? "Running now"
        : `Running now · started ${formatWaited(state.startedAt, now)}`
    }
    const last =
      state.lastRunAt === undefined
        ? "Not run yet"
        : `Last run ${formatWaited(state.lastRunAt, now)}`
    const next =
      state.nextRunAt === undefined
        ? state.status === "live"
          ? "nothing scheduled"
          : "starts after setup"
        : `next ${formatInstant(state.nextRunAt, timezone)}`
    return `${last} · ${next}`
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-2">
        <div className="flex min-w-0 flex-col gap-1">
          {runState === undefined ? (
            <div className="flex h-5 items-center">
              <Skeleton shape="full" className="h-3.5 w-56 max-w-full" />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-foreground">
              {running ? (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 animate-pulse rounded-full bg-primary"
                />
              ) : null}
              {status(runState)}
            </p>
          )}
          {runState !== undefined && runState.needsAttention.count > 0 ? (
            <p className="text-xs text-muted-foreground">
              {runState.needsAttention.count} lead
              {runState.needsAttention.count === 1 ? "" : "s"} need you below.
            </p>
          ) : null}
          <FormError message={error} />
        </div>
        <Button
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
    </div>
  )
}
