import { Link } from "@tanstack/react-router"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import type { RunState } from "./RunStateStrip"

type Signals = FunctionReturnType<typeof api.leads.counts.byStrategy>

export function isLeadDiscoveryPending(
  run: RunState | null | undefined,
  signals: Signals | undefined,
): boolean {
  if (run?.status !== "live" || signals === undefined) {
    return false
  }
  if (run.running) {
    return true
  }
  const enabled = signals.filter((signal) => signal.enabled)
  return (
    run.lastRunAt === undefined &&
    run.nextRunAt !== undefined &&
    enabled.length > 0 &&
    enabled.every((signal) =>
      signal.lastRunAt === undefined &&
      signal.parkedReason === undefined &&
      !signal.exhausted,
    )
  )
}

export function LeadDiscoveryProgress({ running, showLink = false }: {
  running: boolean
  showLink?: boolean
}) {
  return (
    <Card size="sm" role="status" aria-live="polite">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            Finding your first leads…
          </span>
        </CardTitle>
        <CardDescription>
          {running
            ? "Your agent is searching your signals and researching matches. Leads appear automatically as they’re ready."
            : "Your agent is getting ready to search your signals. Your first leads will appear automatically."}
        </CardDescription>
      </CardHeader>
      {showLink ? (
        <CardFooter>
          <Button size="sm" variant="outline" render={<Link to="/leads" />}>
            View leads
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
