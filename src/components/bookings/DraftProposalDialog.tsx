import { CatchBoundary } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { proposalSummary } from "@/components/bookings/booking-presentation"
import { FormError, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { useIntentId } from "@/lib/use-intent-id"

type LeadDetailResult = FunctionReturnType<typeof api.prospects.getDetail>

/**
 * "Write the proposal email" — `bookings.draftProposal`: the exact staged
 * draft that carries the proposal out on the lead's thread.
 *
 * The one pick is real data, never free text: `conversationId`, the lead's
 * open thread. The dialog lists only threads the backend will accept, and a
 * lead with no eligible thread gets the honest reason instead of a form that
 * can never submit.
 *
 * What the submit produces is a DRAFT. Nothing is sent by creating it;
 * sending needs a recorded approval, and the send boundary re-checks the
 * booking link against the approved payload before anything goes out.
 */
export function DraftProposalDialog({
  workspaceId,
  booking,
  detail,
  expectedVersion,
  open,
  onOpenChange,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  detail: LeadDetailResult
  expectedVersion: number
  open: boolean
  onOpenChange: (open: boolean) => void
  timezone: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write the proposal email</DialogTitle>
          <DialogDescription>
            {proposalSummary(booking.proposal, timezone)}. The draft goes out
            verbatim once a person approves it — creating it sends nothing.
          </DialogDescription>
        </DialogHeader>
        <CatchBoundary
          getResetKey={() => booking._id}
          errorComponent={DraftProposalSourcesError}
        >
          <DraftProposalForm
            workspaceId={workspaceId}
            booking={booking}
            detail={detail}
            expectedVersion={expectedVersion}
            onOpenChange={onOpenChange}
          />
        </CatchBoundary>
      </DialogContent>
    </Dialog>
  )
}

function DraftProposalForm({
  workspaceId,
  booking,
  detail,
  expectedVersion,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">
  booking: Doc<"bookings">
  detail: LeadDetailResult
  expectedVersion: number
  onOpenChange: (open: boolean) => void
}) {
  const draftProposal = useMutation(api.bookings.draftProposal)
  const [requestId, rotateIntent] = useIntentId()

  const threads = useQuery(api.conversations.listForProspect, {
    workspaceId,
    prospectId: booking.prospectId,
  })
  const [conversationId, setConversationId] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{
    draftId: Id<"drafts">
  } | null>(null)

  if (threads === undefined) {
    return (
      <LoadingState
        title="Loading the thread"
        description="Reading which conversation this proposal belongs on."
      />
    )
  }

  const openThreads = threads.items.filter((item) => item.state === "open")

  if (created !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">
          The draft is written and waits for a recorded approval. Nothing has
          been sent — a person reviews the exact email on the thread first.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Stay here
          </Button>
        </div>
      </div>
    )
  }

  const recipient =
    detail.prospect.contact?.email ??
    openThreads.find((item) => item.conversationId === conversationId)
      ?.lastInboundFrom

  const submit = () => {
    if (conversationId === "") {
      setError("Pick the thread the proposal goes out on.")
      return
    }
    if (subject.trim() === "" || body.trim() === "") {
      setError("Write the subject and the body — the draft goes out verbatim.")
      return
    }
    setBusy(true)
    setError(null)
    void draftProposal({
      workspaceId,
      bookingId: booking._id,
      expectedVersion,
      conversationId: conversationId as Id<"conversations">,
      subject: subject.trim(),
      body: body.trim(),
      requestId,
    })
      .then((result) => {
        toast.add({
          title: "Proposal draft created — it awaits approval",
          type: "success",
        })
        rotateIntent()
        setCreated({ draftId: result.draft._id })
      })
      .catch((failure: unknown) =>
        setError(
          isConflictError(failure)
            ? `${errorMessage(failure, "The draft conflicts with a newer version.")} Your subject and body are unchanged — re-check the booking, then try again.`
            : errorMessage(failure, "The draft could not be created."),
        ),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="dp-thread">Thread it goes out on</Label>
        {openThreads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open thread exists for this lead — the proposal email can only
            be drafted on an open conversation. The lead needs a thread first
            (an earlier approved send creates one).
          </p>
        ) : (
          <NativeSelect
            id="dp-thread"
            value={conversationId}
            onChange={(event) => setConversationId(event.target.value)}
          >
            <option value="">Pick a thread…</option>
            {openThreads.map((item) => (
              <option key={item.conversationId} value={item.conversationId}>
                {item.lastInboundFrom ?? "Outbound thread"}
                {item.unreadCount > 0 ? ` (${item.unreadCount} unread)` : ""}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Recipient</span>
        <p className="text-sm text-muted-foreground">
          {recipient === undefined
            ? "The backend resolves the recipient — the lead's contact email, or the thread's other party — when the draft is written. There is no address to show yet."
            : `Goes to ${recipient} — resolved from the lead's contact and the thread, not editable here.`}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dp-subject">Subject</Label>
        <Input
          id="dp-subject"
          value={subject}
          placeholder="e.g. A couple of times next week?"
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="dp-body">Body — sent verbatim</Label>
        <Textarea
          id="dp-body"
          value={body}
          rows={6}
          placeholder="Write the email exactly as it should go out. Include the booking link or the offered times yourself — the draft records them, it does not insert them."
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <FormError message={error} />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          disabled={
            busy ||
            openThreads.length === 0 ||
            conversationId === "" ||
            subject.trim() === "" ||
            body.trim() === ""
          }
          onClick={submit}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          Create the draft
        </Button>
      </DialogFooter>
    </div>
  )
}

/**
 * The two bounded reads are new in this lane — a deployment that predates
 * them has neither, and the dialog degrades to an honest note rather than a
 * dead form.
 */
function DraftProposalSourcesError({ error, reset }: ErrorComponentProps) {
  const missing =
    error instanceof Error && /function|Could not find/i.test(error.message)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {missing
          ? "The deployment behind this build does not yet serve the per-lead thread reads — they land with this change's push. The proposal itself is unchanged."
          : "The thread list could not be loaded."}
      </p>
      <Button variant="outline" size="sm" className="self-start" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
