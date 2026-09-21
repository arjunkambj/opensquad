import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { EmptyState } from "@/components/states/states"
import {
  USAGE_ACTION_LABEL,
  USAGE_OUTCOME_LABEL,
} from "@/components/billing/usage/usage-labels"
import type { UsageOutcome } from "@/components/billing/usage/usage-labels"
import { Chip, type ChipVariant } from "@/components/kit/Chip"
import { PageSection, TableFrame } from "@/components/kit/PageSection"
import { formatInstant } from "@/lib/presentation"
import { SkeletonRegion } from "@/components/states/skeletons"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Coins01Icon } from "@hugeicons/core-free-icons"

const HISTORY_TITLE = "History"
const HISTORY_DESCRIPTION =
  "Paid steps, newest first. Browsing, approving and sending are free."

const OUTCOME_VARIANT: Record<UsageOutcome, ChipVariant> = {
  billed: "muted",
  refunded: "success",
  pending: "accent",
}

export function UsageHistory({
  orgId,
}: {
  orgId: Id<"orgs">
}) {
  const [trail, setTrail] = useState<string[]>([])
  const cursor = trail.at(-1)
  const result = useQuery(api.billing.queries.history, {
    orgId,
    ...(cursor === undefined ? {} : { cursor }),
  })

  return (
    <PageSection title={HISTORY_TITLE} description={HISTORY_DESCRIPTION}>
      {result === undefined ? (
        <SkeletonRegion label="Loading your usage">
          <UsageTableSkeleton />
        </SkeletonRegion>
      ) : result.entries.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={Coins01Icon}
          title={trail.length === 0 ? "Nothing spent yet" : "No more entries"}
          description={
            trail.length === 0
              ? "Paid steps show up here as soon as they run."
              : "You have reached the end of the history."
          }
        />
      ) : (
        <TableFrame>
          <Table>
            <UsageTableHeader />
            <TableBody>
              {result.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-foreground">
                    {USAGE_ACTION_LABEL[entry.action]}
                  </TableCell>
                  <TableCell>
                    <Chip variant={OUTCOME_VARIANT[entry.outcome]}>
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
        </TableFrame>
      )}
      {result === undefined ||
      (result.nextCursor === null && trail.length === 0) ? null : (
        <div className="flex justify-end gap-2">
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
            disabled={result.nextCursor === null}
            onClick={() => {
              if (result.nextCursor !== null) {
                setTrail([...trail, result.nextCursor])
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Next
          </Button>
        </div>
      )}
    </PageSection>
  )
}

function UsageTableHeader() {
  return (
    <TableHeader>
      <tr className="border-b">
        <TableHead>What ran</TableHead>
        <TableHead>Outcome</TableHead>
        <TableHead className="text-right">Credits</TableHead>
        <TableHead>When</TableHead>
      </tr>
    </TableHeader>
  )
}

/** Mirrors the loaded history section, for the tab-level skeleton. */
export function UsageHistorySkeleton() {
  return (
    <PageSection title={HISTORY_TITLE} description={HISTORY_DESCRIPTION}>
      <UsageTableSkeleton />
    </PageSection>
  )
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5] as const

function UsageTableSkeleton() {
  return (
    <TableFrame>
      <Table aria-hidden="true">
        <UsageTableHeader />
        <TableBody>
          {SKELETON_ROWS.map((row) => (
            <TableRow key={row}>
              <TableCell>
                <Skeleton shape="full" className="h-3.5 w-36" />
              </TableCell>
              <TableCell>
                <Skeleton shape="lg" className="h-6 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton shape="full" className="ml-auto h-3.5 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton shape="full" className="h-3.5 w-28" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}
