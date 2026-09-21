import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Chip } from "@/components/kit/Chip"
import { TableFrame } from "@/components/kit/PageSection"
import { TableSkeleton } from "@/components/states/skeletons"
import { EmptyState, FormError } from "@/components/states/states"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
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
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      {strategies === undefined ? (
        <TableSkeleton rows={5} columns={5} />
      ) : strategies.length === 0 ? (
        <EmptyState
          title="No signals yet"
          description="Setup proposes the first signals from your website and the people you want to reach."
        />
      ) : (
        <TableFrame>
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
                <TableRow
                  key={row.strategyId}
                  data-dimmed={!row.enabled}
                >
                  <TableCell className="whitespace-normal">
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
                      {/* Toggling off and on resumes a parked signal. */}
                      {row.parkedReason === undefined ? null : (
                        <span className="text-xs text-destructive">
                          Paused: this search stopped working. Switch it off
                          and on again to retry it.
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip variant="accent">{SIGNAL_KIND_LABEL[row.signalKind]}</Chip>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.matchCountIsApproximate ? "About " : ""}
                    {row.matchCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.leadsFound.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      aria-label={`Use the ${row.title} signal`}
                      checked={row.enabled}
                      disabled={pendingId === row.strategyId}
                      onCheckedChange={() => void toggle(row)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
      )}
    </div>
  )
}
