/**
 * The signals the agent sources from, and what each one has produced —
 * reference 25's "leads generated per signal" table, which lives here.
 *
 * `leadsFound` is a counter the run itself maintains, so a weak signal is
 * visible and can be switched off; `matchCount` is the free count the signal
 * was validated with. Switching one off needs nothing scheduled: the planner
 * reads `strategies.enabled` before every step, so the NEXT run simply stops
 * searching it, and the leads it already found stay.
 */
import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Chip } from "@/components/kit/Chip"
import { EmptyState, FormError, LoadingState } from "@/components/states/states"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Toggle } from "@/components/ui/toggle"
import type { StrategyRow } from "./agent-model"
import { agentErrorCopy, SIGNAL_KIND_LABEL } from "./agent-model"

export function SignalsCard({
  orgId,
  strategies,
}: {
  orgId: Id<"orgs">
  strategies: StrategyRow[] | undefined
}) {
  const setEnabled = useMutation(api.agents.settingsRun.setStrategyEnabled)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = async (row: StrategyRow) => {
    setPendingId(row.strategyId)
    setError(null)
    try {
      await setEnabled({
        orgId,
        strategyId: row.strategyId,
        enabled: !row.enabled,
      })
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not change that signal."))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signals</CardTitle>
        <CardDescription>
          What the agent searches for, and how many people each search has
          found. Switching one off takes effect on the next run.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FormError message={error} />
        {strategies === undefined ? (
          <LoadingState
            title="Loading signals"
            description="Reading this agent's searches."
          />
        ) : strategies.length === 0 ? (
          <EmptyState
            title="No signals yet"
            description="Setup proposes the first signals from your website and the people you want to reach."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Signal</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Matches</TableHead>
                <TableHead className="text-right">Leads found</TableHead>
                <TableHead className="text-right">On</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strategies.map((row) => (
                <TableRow key={row.strategyId}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium text-foreground">
                        {row.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.rationale}
                      </span>
                      {row.exhausted ? (
                        <span className="text-xs text-muted-foreground">
                          Every page of this search has been read.
                        </span>
                      ) : null}
                      {/* A parked signal is skipped by the run until it is
                          switched off and on again — so the row has to say
                          so, or the agent silently sources less than the
                          list on screen implies. */}
                      {row.parkedReason === undefined ? null : (
                        <span className="text-xs text-destructive">
                          Paused: this search stopped working. Switch it off
                          and on again to retry it.
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip>{SIGNAL_KIND_LABEL[row.signalKind]}</Chip>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {/* "About N" when the provider estimated the count rather
                        than ran it — never an estimate shown as exact. */}
                    {row.matchCountIsApproximate ? "About " : ""}
                    {row.matchCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.leadsFound.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Toggle
                      variant="outline"
                      size="sm"
                      aria-label={`Use the ${row.title} signal`}
                      pressed={row.enabled}
                      disabled={pendingId === row.strategyId}
                      onPressedChange={() => void toggle(row)}
                    >
                      {row.enabled ? "On" : "Off"}
                    </Toggle>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
