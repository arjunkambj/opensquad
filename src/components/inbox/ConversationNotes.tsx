import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { formatInstant } from "@/components/decisions/decision-presentation"
import { FormError, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import type { WorkspaceRole } from "@/lib/workspace-role"

/**
 * Internal notes on one thread (`conversationNotes`).
 *
 * `note` rows are human annotations; `system` rows are the lifecycle trail a
 * mission-less thread would otherwise have nowhere to put (integrator D1).
 * Neither can resolve a business approval — a note never moves a decision —
 * so the composer sits under its own heading, deliberately away from the
 * takeover/resume controls, exactly as a comment sits outside the
 * approve/reject group on a decision (§4.2 / J3 ③).
 */
export function ConversationNotes({
  workspaceId,
  role,
  conversation,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
  conversation: Doc<"conversations">
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const page = useQuery(api.conversations.listNotes, {
    workspaceId,
    conversationId: conversation._id,
    ...(cursor === undefined ? {} : { cursor }),
  })
  const addNote = useMutation(api.conversations.addNote)

  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canNote = role === "owner" || role === "operator"
  // A closed thread is read-only end to end (`plan/ux.md` §233) — the notes
  // stay, the composer does not.
  const readOnly = conversation.state === "closed"

  const submit = () => {
    const trimmed = body.trim()
    if (trimmed.length === 0) {
      return
    }
    setPending(true)
    setError(null)
    void addNote({
      workspaceId,
      conversationId: conversation._id,
      body: trimmed,
    })
      .then(() => {
        setBody("")
        toast.add({ title: "Note added", type: "success" })
      })
      .catch((cause) =>
        setError(errorMessage(cause, "Could not add the note.")),
      )
      .finally(() => setPending(false))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>
          Private to this workspace. A note records context — it can never
          approve, resume or send anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {page === undefined ? (
          <LoadingState title="Loading notes" />
        ) : page.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notes yet. System events on the thread are recorded here too.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((note) => (
              <li
                key={note._id}
                className={
                  note.kind === "system"
                    ? "rounded-2xl bg-muted/50 px-3 py-2"
                    : "rounded-2xl border border-border px-3 py-2"
                }
              >
                <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                  {note.body}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {note.kind === "system" ? "System" : note.actor} ·{" "}
                  {formatInstant(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {page !== undefined && (page.hasMore || cursor !== undefined) ? (
          <div className="flex flex-wrap items-center gap-2">
            {cursor !== undefined ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor(undefined)}
              >
                First page
              </Button>
            ) : null}
            {page.hasMore && page.cursor !== null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCursor(page.cursor ?? undefined)}
              >
                Older notes
              </Button>
            ) : null}
          </div>
        ) : null}

        {canNote && !readOnly ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="conversation-note">Add a note</Label>
            <Textarea
              id="conversation-note"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Context the next person working this thread needs"
              maxLength={4000}
            />
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || body.trim().length === 0}
                onClick={submit}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Add note
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? "Closed threads are read-only — reopen it to add a note."
              : "You have read-only access to this workspace. An owner or operator can add notes."}
          </p>
        )}
        <FormError message={error} />
      </CardContent>
    </Card>
  )
}
