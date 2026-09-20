import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { useRequestIntents } from "@/lib/use-request-intents"
import { FormError } from "@/components/states/states"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"

/**
 * Human editing of a draft revision — `drafts.revise`.
 *
 * The contract this dialog exists to honour: a draft row is immutable, so an
 * edit is never a patch — it writes revision N+1, supersedes the open
 * approval ask on N, and opens a fresh one on the new bytes. The dialog says
 * that before the click, because "an edit withdraws the old approval" is the
 * single most surprising consequence here (J3 ④).
 *
 * `expectedRevision` is the revision the reviewer read — a colleague's edit
 * between open and submit fails CONFLICT, and the typed text survives it in
 * the still-open dialog rather than being thrown away.
 */
export function EditDraftDialog({
  workspaceId,
  draft,
  open,
  onOpenChange,
}: {
  workspaceId: Id<"workspaces">
  draft: Doc<"drafts">
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const revise = useMutation(api.outreach.drafts.revise)
  const intentId = useRequestIntents()

  const [recipient, setRecipient] = useState(draft.recipient)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed =
    recipient.trim() !== draft.recipient ||
    subject !== draft.subject ||
    body !== draft.body

  const submit = () => {
    if (!changed || busy) {
      return
    }
    setBusy(true)
    setError(null)
    void revise({
      workspaceId,
      draftId: draft._id,
      expectedRevision: draft.revision,
      // Only the fields that changed — revise requires at least one, and
      // sending an unchanged field would only blur what the edit was.
      ...(recipient.trim() !== draft.recipient
        ? { recipient: recipient.trim() }
        : {}),
      ...(subject !== draft.subject ? { subject } : {}),
      ...(body !== draft.body ? { body } : {}),
      requestId: intentId(draft._id, "revise"),
    })
      .then(() => {
        onOpenChange(false)
        toast.add({
          title: "New revision saved",
          description:
            "The previous approval ask was withdrawn and a fresh one opened on the new content.",
          type: "success",
        })
      })
      .catch((cause) =>
        setError(
          isConflictError(cause)
            ? `${errorMessage(cause, "This draft moved while you were editing it.")} Your text is still here — close this, review the current revision, and edit that one instead.`
            : errorMessage(cause, "Could not save the revision."),
        ),
      )
      .finally(() => setBusy(false))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next)
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit this email</DialogTitle>
          <DialogDescription>
            Saving writes a new revision — the approval ask on revision{" "}
            {draft.revision} is withdrawn and a fresh ask opens on the new
            content. Approval can never carry over to different bytes.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-draft-recipient">To</Label>
            <Input
              id="edit-draft-recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-draft-subject">Subject</Label>
            <Input
              id="edit-draft-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-draft-body">Body</Label>
            <Textarea
              id="edit-draft-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={12}
              className="font-mono"
            />
          </div>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={busy || !changed}
            aria-describedby={changed ? undefined : "edit-draft-unchanged"}
            onClick={submit}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Save as a new revision
          </Button>
        </DialogFooter>
        {changed ? null : (
          <p
            id="edit-draft-unchanged"
            role="status"
            className="text-xs text-muted-foreground"
          >
            Nothing is changed yet — there is no new revision to save.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
