/**
 * Leads the agent gave up on, and the button that puts one back in the queue
 * (PLAN §9.1 "Retries").
 *
 * A lead reaches `needs_attention` after three failed attempts at the same
 * step; the row says which, in our words, never the provider's. Retry clears
 * the ladder and makes the lead due again — it does not perform the step, so
 * nothing is spent by pressing it.
 *
 * The card renders nothing at all when no lead is parked: a permanently
 * present "nothing needs you" panel is chrome.
 */
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { formatWaited } from "@/lib/presentation"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { agentErrorCopy, OPERATION_ERROR_COPY } from "./agent-model"

/** How many parked leads the card lists before pointing at Contacts. */
const PARKED_SHOWN = 5

type ParkedLead = FunctionReturnType<
  typeof api.leads.queries.list
>["items"][number]

/** The person as the source named them; a masked surname stays masked. */
function leadName(lead: ParkedLead): string {
  const parts = [lead.firstName, lead.lastName].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  if (parts.length > 0) {
    return parts.join(" ")
  }
  return lead.companyName ?? "A lead"
}

/**
 * Why it stopped. The stored `stageReason` is the sentence the backend wrote
 * when it parked the lead; the error code is the fallback, mapped here.
 */
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
}: {
  orgId: Id<"orgs">
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
    <Card>
      <CardHeader>
        <CardTitle>Needs you</CardTitle>
        <CardDescription>
          The agent retried these and stopped. Retry puts one back in the queue
          and wakes the agent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <FormError message={error} />
        <ul className="flex flex-col gap-2">
          {page.items.map((lead) => (
            <li
              key={lead._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">
                  {leadName(lead)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {parkedReason(lead)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Stopped {formatWaited(lead.updatedAt)}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingId === lead._id}
                onClick={() => void retry(lead)}
              >
                Retry
              </Button>
            </li>
          ))}
        </ul>
        {page.hasMore ? (
          <p className="text-xs text-muted-foreground">
            More are waiting in Contacts, under the "Needs attention" stage.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
