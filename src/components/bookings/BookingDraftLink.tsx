import { CatchBoundary, Link } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { EditDraftDialog } from "@/components/decisions/EditDraftDialog"
import {
  Chip,
  attemptStateLabel,
  formatWaited,
  shortHash,
} from "@/components/decisions/decision-presentation"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The booking's proposal draft, and the way to its approval ask.
 *
 * The ask is resolved by `decisions.listForDraft` — one of this lane's
 * bounded reads — and links to `/decisions/$decisionId`, where the shared
 * `DraftApprovalPanel` does the approving. Nothing here re-renders approval
 * controls: this surface points at the queue, it does not re-implement it.
 *
 * The draft preview shows the exact recipient/subject/body as stored — a
 * draft is a *staged* thing, so it is labelled as one and never rendered as
 * sent mail (V05). Send state comes from `sending.preflight`'s attempt list,
 * the same facts the thread view reads.
 */
export function BookingDraftLink({
  workspaceId,
  draftId,
  bookingVersion,
}: {
  workspaceId: Id<"workspaces">
  draftId: Id<"drafts">
  bookingVersion: number
}) {
  return (
    <CatchBoundary
      getResetKey={() => draftId}
      errorComponent={BookingDraftLinkError}
    >
      <BookingDraftLinkBody
        workspaceId={workspaceId}
        draftId={draftId}
        bookingVersion={bookingVersion}
      />
    </CatchBoundary>
  )
}

function BookingDraftLinkBody({
  workspaceId,
  draftId,
  bookingVersion,
}: {
  workspaceId: Id<"workspaces">
  draftId: Id<"drafts">
  bookingVersion: number
}) {
  const draft = useQuery(api.drafts.get, { workspaceId, draftId })
  const asks = useQuery(api.decisions.listForDraft, { workspaceId, draftId })
  const preflight = useQuery(api.sending.preflight, { workspaceId, draftId })
  const [editOpen, setEditOpen] = useState(false)

  if (draft === undefined || asks === undefined || preflight === undefined) {
    return (
      <LoadingState
        title="Loading the draft"
        description="Reading the proposal email and its approval ask."
      />
    )
  }

  const openAsk = asks.items.find(
    (decision) =>
      decision.kind === "draft_approval" && decision.state === "open",
  )
  const latestAttempt =
    preflight.attempts.length === 0
      ? undefined
      : preflight.attempts[preflight.attempts.length - 1]
  const superseded = draft.supersededAt !== undefined
  const pinnedStale =
    draft.bookingVersion !== undefined && draft.bookingVersion !== bookingVersion

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip>
          {superseded
            ? "Superseded — a newer revision exists"
            : latestAttempt === undefined
              ? "Draft — not sent"
              : attemptStateLabel(latestAttempt.state)}
        </Chip>
        <span className="text-xs text-muted-foreground">
          revision {draft.revision} · to {draft.recipient} · written{" "}
          {formatWaited(draft.createdAt)}
        </span>
      </div>
      {pinnedStale ? (
        <p role="status" className="text-xs text-destructive">
          This draft was written against booking version{" "}
          {draft.bookingVersion}; the booking is now version {bookingVersion}.
          The send boundary refuses it — revise so the draft re-pins the
          current proposal.
        </p>
      ) : null}
      <p className="text-sm font-medium text-foreground">{draft.subject}</p>
      <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">
        {draft.body}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {openAsk !== undefined ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/decisions/$decisionId"
                params={{ decisionId: openAsk._id }}
              />
            }
          >
            Review the approval ask
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            {asks.items.length === 0
              ? "No approval ask is linked to this draft."
              : "The approval ask was resolved — the queue has the outcome."}
          </p>
        )}
        {latestAttempt === undefined && !superseded ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
          >
            Edit the draft
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Payload {shortHash(draft.payloadHash)}
        {!preflight.permitted
          ? ` · send is currently not permitted — ${preflight.reason ?? "a gate is holding it"}`
          : " · the send boundary still re-checks the booking before anything goes out"}
      </p>
      <EditDraftDialog
        workspaceId={workspaceId}
        draft={draft}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  )
}

/**
 * The two bounded reads are new in this lane — a deployment that predates
 * them has no `listForDraft`, and the preview degrades to an honest note
 * rather than a broken booking card.
 */
function BookingDraftLinkError({ error, reset }: ErrorComponentProps) {
  const missing =
    error instanceof Error && /function|Could not find/i.test(error.message)
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-1 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground",
      )}
    >
      {missing ? (
        <span className="flex-1">
          The linked draft cannot be read yet — the deployment behind this
          build does not yet serve the per-draft ask lookup. The proposal
          record above is unchanged.
        </span>
      ) : (
        <span className="flex-1">The linked draft could not be loaded.</span>
      )}
      <Button variant="ghost" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
