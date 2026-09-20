/**
 * What a person can decide about a thread: record the meeting it produced,
 * stop or restart the agent on it, and close or reopen it.
 *
 * Nothing here is inferred from message content. In particular, a meeting is
 * booked only by the click below (PLAN §9.5) — a model may point out that the
 * lead confirmed a time, and it still takes a person to say so.
 */
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { MarkAsBookedDialog } from "@/components/inbox/MarkAsBookedDialog"
import { resumeBlockCopy } from "@/components/inbox/thread/resume-block-copy"
import { FormError, PermissionNote } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import { useRequestIntents } from "@/lib/use-request-intents"
import type { WorkspaceRole } from "@/lib/workspace-role"

type Detail = FunctionReturnType<typeof api.inbox.conversations.get>

export function ConversationActions({
  workspaceId,
  role,
  conversation,
  prospect,
  expectedContextVersion,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
  conversation: Doc<"conversations">
  prospect: Detail["prospect"]
  expectedContextVersion: number
}) {
  const setTakeover = useMutation(api.inbox.conversationLifecycle.setTakeover)
  const resume = useMutation(api.inbox.conversationResume.resume)
  const close = useMutation(api.inbox.conversationLifecycle.close)
  const reopen = useMutation(api.inbox.conversationLifecycle.reopen)
  const intentId = useRequestIntents()

  // The live proposal this thread's lead holds, if any — `confirm` needs one,
  // and the dialog opens a proposal for the agreed time when there is none.
  const proposals = useQuery(
    api.bookings.queries.list,
    prospect === null
      ? "skip"
      : {
          workspaceId,
          prospectId: prospect.prospectId,
          state: "proposed" as const,
          limit: 1,
        },
  )

  const [booking, setBooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAct = role === "owner" || role === "operator"
  const closed = conversation.state === "closed"

  const run = (work: Promise<unknown>, title: string, failure: string) => {
    setBusy(true)
    setError(null)
    void work
      .then(() => toast.add({ title, type: "success" }))
      .catch((cause) => setError(errorMessage(cause, failure)))
      .finally(() => setBusy(false))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>This conversation</CardTitle>
        <CardDescription>
          A meeting counts when you say it does — nothing your agent reads in a
          reply books one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canAct ? (
          <div className="flex flex-wrap gap-2">
            {prospect === null ? null : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || proposals === undefined}
                onClick={() => setBooking(true)}
              >
                Mark as booked
              </Button>
            )}
            {conversation.humanTakeover ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed}
                onClick={() => {
                  setBusy(true)
                  setError(null)
                  void resume({
                    workspaceId,
                    conversationId: conversation._id,
                    expectedContextVersion,
                    requestId: intentId(conversation._id, "resume"),
                  })
                    .then((result) =>
                      result.blockedBy === undefined
                        ? toast.add({
                            title: "Your agent is working this thread again",
                            type: "success",
                          })
                        : setError(resumeBlockCopy(result.blockedBy)),
                    )
                    .catch((cause) =>
                      setError(
                        errorMessage(cause, "Could not resume this thread."),
                      ),
                    )
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Let the agent answer again
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || closed}
                onClick={() =>
                  run(
                    setTakeover({
                      workspaceId,
                      conversationId: conversation._id,
                      expectedContextVersion,
                      enabled: true,
                    }),
                    "The agent will not answer this thread",
                    "Could not pause the agent on this thread.",
                  )
                }
              >
                Answer this one myself
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(
                  closed
                    ? reopen({
                        workspaceId,
                        conversationId: conversation._id,
                        expectedContextVersion,
                      })
                    : close({
                        workspaceId,
                        conversationId: conversation._id,
                        expectedContextVersion,
                      }),
                  closed ? "Conversation reopened" : "Conversation closed",
                  closed
                    ? "Could not reopen this conversation."
                    : "Could not close this conversation.",
                )
              }
            >
              {closed ? "Reopen" : "Close"}
            </Button>
          </div>
        ) : (
          <PermissionNote role={role} action="act on this conversation" />
        )}
        <FormError message={error} />
      </CardContent>

      {booking && prospect !== null ? (
        <MarkAsBookedDialog
          workspaceId={workspaceId}
          prospectId={prospect.prospectId}
          conversationId={conversation._id}
          existingProposal={proposals?.items[0] ?? null}
          open={booking}
          onOpenChange={setBooking}
        />
      ) : null}
    </Card>
  )
}
