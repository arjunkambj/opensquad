/**
 * The credit history from the real ledger, newest first.
 *
 * Keyset pagination on the entry's own timestamp: the query hands back where
 * the next page starts, and the cursors already walked are kept here so Back
 * is a pop. Numbered pages would be a lie — a settling reservation changes
 * what lies between two of them.
 *
 * Every line is an action the user took, labelled through the one white-label
 * map. Nothing here knows which provider answered, because the query never
 * says.
 */
import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { EmptyState } from "@/components/states/states"
import {
  USAGE_ACTION_LABEL,
  USAGE_OUTCOME_LABEL,
} from "@/components/settings/usage/usage-labels"
import type { UsageOutcome } from "@/components/settings/usage/usage-labels"
import { Chip, formatInstant } from "@/components/shared/presentation"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { cn } from "@/lib/utils"
import { Coins01Icon } from "@hugeicons/core-free-icons"

/** Outcome styling, all through semantic tokens so it reads in both themes. */
const OUTCOME_CLASS: Record<UsageOutcome, string> = {
  billed: "bg-muted text-muted-foreground",
  refunded: "bg-chart-2/15 text-foreground",
  pending: "bg-primary/10 text-primary",
}

export function UsageHistory({
  orgId,
}: {
  orgId: Id<"orgs">
}) {
  const [trail, setTrail] = useState<number[]>([])
  const before = trail.at(-1)
  const result = useQuery(api.billing.queries.history, {
    orgId,
    ...(before === undefined ? {} : { before }),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          Every paid step this organization has taken, newest first. Browsing,
          approving, sending and handling unsubscribes are free and never
          appear here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result === undefined ? (
          <LoadingState title="Loading your usage" />
        ) : result.entries.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={Coins01Icon}
            title={
              trail.length === 0 ? "Nothing spent yet" : "No more entries"
            }
            description={
              trail.length === 0
                ? "Your first website analysis, lead search or researched company will show up here the moment it runs."
                : "You have reached the end of this organization's history."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What ran</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.entries.map((entry) => (
                <TableRow key={`${entry.at}-${entry.action}-${entry.credits}`}>
                  <TableCell className="text-foreground">
                    {USAGE_ACTION_LABEL[entry.action]}
                  </TableCell>
                  <TableCell>
                    <Chip className={cn(OUTCOME_CLASS[entry.outcome])}>
                      {USAGE_OUTCOME_LABEL[entry.outcome]}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">
                    {entry.credits}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatInstant(entry.at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {result === undefined ||
      (result.nextBefore === null && trail.length === 0) ? null : (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button
            disabled={trail.length === 0}
            onClick={() => setTrail(trail.slice(0, -1))}
            size="sm"
            type="button"
            variant="outline"
          >
            Back
          </Button>
          <Button
            disabled={result.nextBefore === null}
            onClick={() => {
              if (result.nextBefore !== null) {
                setTrail([...trail, result.nextBefore])
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Next
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}
