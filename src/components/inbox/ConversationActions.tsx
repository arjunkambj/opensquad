/**
 * The thread's toolbar: record the meeting it produced, stop or restart the
 * agent on it, and close or reopen it. Refusals surface as toasts.
 *
 * Nothing here is inferred from message content. In particular, a meeting is
 * booked only by the click below (PLAN §9.5) — a model may point out that the
 * lead confirmed a time, and it still takes a person to say so.
 */
import {
  ArrowUpRight01Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { MARK_INTERESTED_COPY } from "@/components/inbox/inbox-presentation"
import { MarkAsBookedDialog } from "@/components/inbox/MarkAsBookedDialog"
import { resumeBlockCopy } from "@/components/inbox/thread/resume-block-copy"
import { AssociateLeadButton } from "@/components/inbox/thread/AssociateLeadButton"
import { Hint } from "@/components/kit/Hint"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"
import { useRequestIntents } from "@/lib/use-request-intents"

type Detail = FunctionReturnType<typeof api.inbox.conversations.get>

export function ConversationActions({
  orgId,
  conversation,
  prospect,
  expectedContextVersion,
}: {
  orgId: Id<"orgs">
  conversation: Doc<"conversations">
  prospect: Detail["prospect"]
  expectedContextVersion: number
}) {
  const markInterested = useMutation(api.inbox.replies.markInterested)
  const setTakeover = useMutation(api.inbox.conversationLifecycle.setTakeover)
  const resume = useMutation(api.inbox.conversationResume.resume)
  const close = useMutation(api.inbox.conversationLifecycle.close)
  const reopen = useMutation(api.inbox.conversationLifecycle.reopen)
  const intentId = useRequestIntents()
  const navigate = useNavigate()

  // The live proposal this thread's lead holds, if any — `confirm` needs one,
  // and the dialog opens a proposal for the agreed time when there is none.
  const proposals = useQuery(
    api.bookings.queries.list,
    prospect === null
      ? "skip"
      : {
          orgId,
          prospectId: prospect.prospectId,
          state: "proposed" as const,
          limit: 1,
        },
  )

  const [booking, setBooking] = useState(false)
  const [busy, setBusy] = useState(false)

  const closed = conversation.state === "closed"
  const base = { orgId, conversationId: conversation._id, expectedContextVersion }
  // Once the thread carries the tag the button would change nothing.
  const alreadyInterested = conversation.lastDisposition === "interested"

  const run = (work: Promise<unknown>, title: string, failure: string) => {
    setBusy(true)
    void work
      .then(() => toast.add({ title, type: "success" }))
      .catch((cause) =>
        toast.add({ title: errorMessage(cause, failure), type: "error" }),
      )
      .finally(() => setBusy(false))
  }

  const resumeAgent = () => {
    setBusy(true)
    void resume({ ...base, requestId: intentId(conversation._id, "resume") })
      .then((result) =>
        result.blockedBy === undefined
          ? toast.add({
              title: "Your agent is working this thread again",
              type: "success",
            })
          : toast.add({ title: resumeBlockCopy(result.blockedBy), type: "error" }),
      )
      .catch((cause) =>
        toast.add({
          title: errorMessage(cause, "Could not resume this thread."),
          type: "error",
        }),
      )
      .finally(() => setBusy(false))
  }

  const pauseAgent = () =>
    run(
      setTakeover({ ...base, enabled: true }),
      "The agent will not answer this thread",
      "Could not pause the agent on this thread.",
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {prospect === null ? (
        <AssociateLeadButton
          orgId={orgId}
          conversation={conversation}
          expectedContextVersion={expectedContextVersion}
        />
      ) : (
        <Hint content="A meeting counts only when you mark it — nothing the agent reads in a reply books one.">
          <Button
            disabled={busy || proposals === undefined}
            onClick={() => setBooking(true)}
          >
            Mark as booked
          </Button>
        </Hint>
      )}

      {conversation.humanTakeover ? (
        <Hint
          content={
            closed
              ? "Reopen the thread first."
              : "Your agent drafts replies on this thread again."
          }
        >
          <Button variant="outline" disabled={busy || closed} onClick={resumeAgent}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Resume agent
          </Button>
        </Hint>
      ) : (
        <Hint
          content={
            closed
              ? "Reopen the thread first."
              : "Your agent stops answering this thread so you can reply yourself."
          }
        >
          <Button variant="outline" disabled={busy || closed} onClick={pauseAgent}>
            Answer myself
          </Button>
        </Hint>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="More thread actions"
              size="icon"
              variant="muted"
              disabled={busy}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {prospect === null ? null : (
            <>
              <DropdownMenuItem
                onClick={() =>
                  void navigate({
                    to: "/leads",
                    search: { lead: prospect.prospectId },
                  })
                }
              >
                <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} />
                Open the lead
              </DropdownMenuItem>
              {alreadyInterested ? null : (
                <DropdownMenuItem
                  disabled={closed}
                  onClick={() =>
                    run(
                      markInterested({
                        ...base,
                        requestId: intentId(conversation._id, "mark-interested"),
                      }),
                      MARK_INTERESTED_COPY.success,
                      MARK_INTERESTED_COPY.failure,
                    )
                  }
                >
                  {MARK_INTERESTED_COPY.label}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            onClick={() =>
              run(
                closed ? reopen(base) : close(base),
                closed ? "Conversation reopened" : "Conversation closed",
                closed
                  ? "Could not reopen this conversation."
                  : "Could not close this conversation.",
              )
            }
          >
            {closed ? "Reopen conversation" : "Close conversation"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {booking && prospect !== null ? (
        <MarkAsBookedDialog
          orgId={orgId}
          prospectId={prospect.prospectId}
          conversationId={conversation._id}
          existingProposal={proposals?.items[0] ?? null}
          open={booking}
          onOpenChange={setBooking}
        />
      ) : null}
    </div>
  )
}
