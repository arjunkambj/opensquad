import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { LEAD_STAGES } from "../../../convex/lib/validators"
import type { LeadApproval, LeadStage } from "../../../convex/lib/validators"
import { Chip, formatWaited } from "@/components/shared/presentation"
import { EmptyState, FormError, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { errorMessage } from "@/lib/convex-error"
import { withFilters } from "@/lib/search-params"
import { useRequestIntents } from "@/lib/use-request-intents"
import type { LeadsSearch } from "@/routes/_dashboard/_workspace/leads"

const LEADS_ROUTE = "/_dashboard/_workspace/leads"

type LeadRow = FunctionReturnType<typeof api.leads.queries.list>["items"][number]

const STAGE_LABEL: Record<LeadStage, string> = {
  found: "Found",
  researched: "Researched",
  queued: "Queued",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting_proposed: "Meeting proposed",
  meeting_booked: "Meeting booked",
  closed_lost: "Closed lost",
  rejected: "Rejected",
  needs_attention: "Needs attention",
}

const APPROVAL_LABEL: Record<LeadApproval, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
}

/** The person's name as the source gave it — a masked surname stays masked. */
function personName(lead: LeadRow): string {
  const parts = [lead.firstName, lead.lastName].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  return parts.length > 0 ? parts.join(" ") : "Name locked"
}

/**
 * The score, read through the research variant — never a bare `aiScore`.
 * A lead that has not been researched has no score to show, which is a state
 * of its own ("Not researched yet"), not a zero.
 */
function scoreLabel(lead: LeadRow): string {
  switch (lead.research.status) {
    case "researched":
      return "🔥".repeat(lead.research.aiScore)
    case "researching":
      return "Researching…"
    case "failed":
      return "Research failed"
    case "not_researched":
      return "Not researched yet"
  }
}

/**
 * `/leads` — every person the agent has found, and where each one stands.
 *
 * One list mode at a time, each an exact index range: a stage filter, the
 * approval queue, or company-name search. The backend refuses combinations no
 * index supports, so the controls never offer one.
 *
 * Approve/Reject here is LEAD approval (PLAN §9.3) — "yes, contact this
 * person". It authorises finding the address and drafting; it sends nothing.
 *
 * This is the pre-pivot CRM list reduced to the new model. The reference
 * Contacts table (search, bulk actions, signal column, reveal, drawer) is
 * T31's to build.
 */
export function LeadList({ workspaceId }: { workspaceId: Id<"workspaces"> }) {
  const search = useSearch({ from: LEADS_ROUTE })
  const navigate = useNavigate()
  const setApproval = useMutation(api.leads.mutations.setApproval)
  const intentFor = useRequestIntents()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const text = search.q ?? ""
  const listArgs = {
    workspaceId,
    ...(search.stage !== undefined ? { stage: search.stage } : {}),
    ...(search.approval !== undefined ? { approval: search.approval } : {}),
    ...(search.cursor !== undefined ? { cursor: search.cursor } : {}),
    ...(search.limit !== undefined ? { limit: search.limit } : {}),
  }
  const page = useQuery(
    text === "" ? api.leads.queries.list : api.leads.queries.search,
    text === "" ? listArgs : { ...listArgs, text },
  )

  /** A filter change. `withFilters` drops the cursor, because page two of one
   *  query is not page two of another. */
  const apply = (patch: Partial<LeadsSearch>) => {
    void navigate({
      to: "/leads",
      search: (current: LeadsSearch) => withFilters(current, patch),
    })
  }

  /** Paging keeps the filters and moves the cursor — the one change that must
   *  NOT go through `withFilters`, which would clear the cursor it just set. */
  const goToCursor = (cursor: string) => {
    void navigate({
      to: "/leads",
      search: (current: LeadsSearch) => ({ ...current, cursor }),
    })
  }

  const decide = async (lead: LeadRow, approval: LeadApproval) => {
    setPendingId(lead._id)
    setError(null)
    try {
      await setApproval({
        workspaceId,
        prospectId: lead._id,
        approval,
        ...(approval === "rejected"
          ? { reason: "Rejected from the leads list" }
          : {}),
        requestId: intentFor(lead._id, approval),
      })
    } catch (cause) {
      setError(errorMessage(cause, "Could not record that decision."))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="leads-q">Search company</Label>
          <Input
            id="leads-q"
            value={text}
            placeholder="Company name"
            onChange={(event) =>
              apply({ q: event.target.value.trim() || undefined })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="leads-stage">Stage</Label>
          <NativeSelect
            id="leads-stage"
            value={search.stage ?? ""}
            onChange={(event) =>
              apply({
                stage: (event.target.value || undefined) as
                  | LeadStage
                  | undefined,
                // One index per mode: a stage filter replaces the approval
                // queue rather than being post-filtered on top of it.
                approval: undefined,
              })
            }
          >
            <option value="">Every stage</option>
            {LEAD_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABEL[stage]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="leads-approval">Approval</Label>
          <NativeSelect
            id="leads-approval"
            value={search.approval ?? ""}
            onChange={(event) =>
              apply({
                approval: (event.target.value || undefined) as
                  | LeadApproval
                  | undefined,
                stage: undefined,
              })
            }
          >
            <option value="">Any decision</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </NativeSelect>
        </div>
      </div>

      <FormError message={error} />

      {page === undefined ? (
        <LoadingState
          title="Loading leads"
          description="Reading this workspace's leads."
        />
      ) : page.items.length === 0 ? (
        <EmptyState
          title="No leads yet"
          description="Leads appear here once the agent runs its first search. Finish onboarding to give it an ICP and its first signals."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((lead) => (
                <TableRow key={lead._id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{personName(lead)}</span>
                      <span className="text-xs text-muted-foreground">
                        {[lead.jobTitle, lead.companyName]
                          .filter(
                            (part): part is string =>
                              part !== undefined && part.length > 0,
                          )
                          .join(" · ")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{scoreLabel(lead)}</TableCell>
                  <TableCell>
                    <Chip>{STAGE_LABEL[lead.stage]}</Chip>
                  </TableCell>
                  <TableCell>
                    {lead.emailStatus === "found"
                      ? (lead.email ?? "Found")
                      : lead.emailStatus === "revealing"
                        ? "Finding…"
                        : lead.emailStatus === "not_found"
                          ? "None on file"
                          : "Locked"}
                  </TableCell>
                  <TableCell>{APPROVAL_LABEL[lead.approval]}</TableCell>
                  <TableCell>{formatWaited(lead.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          pendingId === lead._id || lead.approval === "approved"
                        }
                        onClick={() => void decide(lead, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          pendingId === lead._id || lead.approval === "rejected"
                        }
                        onClick={() => void decide(lead, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!page.hasMore || page.cursor === null}
              onClick={() => {
                if (page.cursor !== null) {
                  goToCursor(page.cursor)
                }
              }}
            >
              Next page
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
