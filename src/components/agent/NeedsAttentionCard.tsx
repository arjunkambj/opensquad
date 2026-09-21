import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatWaited } from "@/lib/presentation"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/kit/Chip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { agentErrorCopy, OPERATION_ERROR_COPY } from "./agent-model"

const PARKED_SHOWN = 5

type ParkedLead = FunctionReturnType<
  typeof api.leads.queries.list
>["items"][number]

function leadName(lead: ParkedLead): string {
  const parts = [lead.firstName, lead.lastName].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  if (parts.length > 0) {
    return parts.join(" ")
  }
  return lead.companyName ?? "A lead"
}

function parkedReason(lead: ParkedLead): string {
  if (lead.stageReason !== undefined && lead.stageReason.length > 0) {
    return lead.stageReason
  }
  if (lead.lastErrorCode !== undefined) {
    return OPERATION_ERROR_COPY[lead.lastErrorCode]
  }
  return "This lead needs a look before the agent works it again."
}

export function NeedsAttentionCard({
  orgId,
  now,
}: {
  orgId: Id<"orgs">
  /** The page's shared clock, so "stopped" ages without a render-time `Date.now()`. */
  now: number
}) {
  const page = useQuery(api.leads.queries.list, {
    orgId,
    stage: "needs_attention",
    limit: PARKED_SHOWN,
  })
  const retryLead = useMutation(api.agents.settingsRun.retryLead)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const retry = async (lead: ParkedLead) => {
    setPendingId(lead._id)
    setError(null)
    try {
      await retryLead({ orgId, prospectId: lead._id })
    } catch (cause) {
      setError(agentErrorCopy(cause, "Could not queue that lead again."))
    } finally {
      setPendingId(null)
    }
  }

  // Still loading, or nothing parked: both render nothing. A panel that
  // exists only to say "all clear" is noise on a page that is otherwise all
  // controls.
  if (page === undefined || page.items.length === 0) {
    return null
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-foreground">Needs you</h2>
        <Chip variant="destructive" className="px-2 py-0.5">
          {page.hasMore ? `${page.items.length}+` : page.items.length}
        </Chip>
        <span className="text-xs text-muted-foreground">
          Your agent gave up on these. Retry queues one again.
        </span>
      </header>
        <FormError message={error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Why it stopped</TableHead>
              <TableHead>Stopped</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((lead) => (
              <TableRow key={lead._id}>
                <TableCell className="font-medium text-foreground">
                  {leadName(lead)}
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {parkedReason(lead)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatWaited(lead.updatedAt, now)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    disabled={pendingId === lead._id}
                    onClick={() => void retry(lead)}
                  >
                    Retry
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {page.hasMore ? (
          <p className="text-xs text-muted-foreground">
            More are waiting in Leads, under the "Needs attention" stage.
          </p>
        ) : null}
    </section>
  )
}
