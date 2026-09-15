import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  formatInstant,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import { actorLabel } from "@/components/missions/MissionReceipts"
import {
  EmptyState,
  FormError,
  LoadingState,
  PermissionNote,
} from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/convex-error"
import type { WorkspaceRole } from "@/lib/workspace-role"
import { canEdit } from "@/lib/workspace-role"

/** `boundedString(body, "body", { min: 1, max: 4000 })` in `activity.ts`. */
const COMMENT_MAX = 4000

/**
 * Notes for the squad, in their own tab and their own card.
 *
 * `activity.ts` states the invariant in its header: mission comments are human
 * notes only, and the module exposes no path from a comment to decision state.
 * So this control sits outside every action group and says so in one line —
 * a note that looks like it might approve something is worse than no note at
 * all, and `plan/ux.md` §8 names exactly that.
 */
export function MissionComments({
  workspaceId,
  missionId,
  role,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  missionId: Id<"missions">
  role: WorkspaceRole
  timezone: string
}) {
  const page = useQuery(api.activity.listComments, { workspaceId, missionId })
  const addComment = useMutation(api.activity.addComment)

  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = body.trim()
  const tooLong = trimmed.length > COMMENT_MAX

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await addComment({ workspaceId, missionId, body: trimmed })
      setBody("")
    } catch (cause) {
      setError(errorMessage(cause, "The note was not saved."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave a note for the squad</CardTitle>
        <CardDescription>
          A note is context for whoever picks this up next. It cannot approve,
          resolve or change anything — those happen on the decision itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canEdit(role) ? (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label="Note"
              placeholder="What should the next person know?"
              value={body}
              disabled={busy}
              aria-describedby="mission-comment-bound"
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={busy || trimmed.length === 0 || tooLong}
                aria-describedby="mission-comment-bound"
                onClick={() => void submit()}
              >
                Add note
              </Button>
              {/* Described, not announced. `aria-describedby` on the button
                  already reads the bound on focus, which is the mechanism
                  that is wanted; `role="status"` on the same paragraph made
                  it a live region whose text changes on every keystroke, so
                  the count was queued for announcement over the typing echo
                  of a 300-character note. */}
              <p
                id="mission-comment-bound"
                className="text-xs text-muted-foreground"
              >
                {tooLong
                  ? `${trimmed.length} characters — the limit is ${COMMENT_MAX}.`
                  : trimmed.length === 0
                    ? "A note needs at least one character."
                    : `${trimmed.length} of ${COMMENT_MAX} characters.`}
              </p>
            </div>
            <FormError message={error} />
          </div>
        ) : (
          <PermissionNote role={role} action="add a note to this mission" />
        )}

        {page === undefined ? (
          <LoadingState
            title="Loading notes"
            description="Reading what the squad has written here."
          />
        ) : page.items.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Nobody has written anything on this mission."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {page.items.map((comment) => (
              <li
                key={comment._id}
                className="flex flex-col gap-1 rounded-[min(var(--radius-4xl),24px)] bg-muted/40 px-4 py-3"
              >
                <p className="text-sm leading-relaxed text-foreground">
                  {comment.body}
                </p>
                <p className="text-xs text-muted-foreground">
                  {actorLabel(comment.authorIdentityKey)} ·{" "}
                  {formatInstant(comment.createdAt, timezone)} ·{" "}
                  {formatWaited(comment.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {page !== undefined && page.hasMore ? (
          <p className="text-xs text-muted-foreground">
            More notes than fit on one page. The most recent are shown.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
