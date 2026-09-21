import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { formatInstant } from "@/lib/presentation"
import { NotesSkeleton } from "@/components/inbox/InboxPageSkeleton"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { PageSection } from "@/components/kit/PageSection"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

export function ConversationNotes({
  orgId,
  conversation,
}: {
  orgId: Id<"orgs">
  conversation: Doc<"conversations">
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const page = useQuery(api.inbox.conversationNotes.listNotes, {
    orgId,
    conversationId: conversation._id,
    ...(cursor === undefined ? {} : { cursor }),
  })
  const addNote = useMutation(api.inbox.conversationNotes.addNote)

  const [body, setBody] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      orgId,
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
    <PageSection
      title="Notes"
      description="Private to your team. Notes never approve or send anything."
    >
        {page === undefined ? (
          <NotesSkeleton />
        ) : page.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No notes yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((note) => (
              <li
                key={note._id}
                className="rounded-lg bg-muted/60 px-3 py-2"
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
                onClick={() => setCursor(undefined)}
              >
                First page
              </Button>
            ) : null}
            {page.hasMore && page.cursor !== null ? (
              <Button
                variant="outline"
                onClick={() => setCursor(page.cursor ?? undefined)}
              >
                Older notes
              </Button>
            ) : null}
          </div>
        ) : null}

        {readOnly ? (
          <p className="text-sm text-muted-foreground">
            Closed threads are read-only — reopen it to add a note.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Textarea
              id="conversation-note"
              aria-label="Add a note"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Context the next person working this thread needs"
              maxLength={4000}
            />
            <div>
              <Button
                disabled={pending || body.trim().length === 0}
                onClick={submit}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Add note
              </Button>
            </div>
          </div>
        )}
        <FormError message={error} />
    </PageSection>
  )
}
