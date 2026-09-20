import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import {
  TAKEOVER_REASON_LABEL,
  resumeBlockLabel,
} from "@/components/inbox/inbox-presentation"
import {
  Chip,
  DetailRow,
  formatInstant,
  formatWaited,
} from "@/components/shared/presentation"
import { useRequestIntents } from "@/lib/use-request-intents"
import {
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import type { WorkspaceRole } from "@/lib/workspace-role"

/**
 * The controls a thread's state actually offers.
 *
 * Two rules from J4 carry this card:
 *
 * ④ Takeover and resume are SEPARATE explicit acts. Takeover freezes
 *    automation — no new drafts, no sends — and the screen says it cannot
 *    recall mail already submitted. Resume is the only path that clears the
 *    freeze, and it re-runs association, sender, agent and policy checks
 *    (`conversations.resume` returns a block code rather than throwing).
 * ⑤ Association dispatches nothing. The screen says so before the click —
 *    linking a lead files the thread and nothing else; Resume is separate
 *    (V16 step 3).
 */
export function ConversationActions({
  workspaceId,
  role,
  conversation,
  expectedContextVersion,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
  conversation: Doc<"conversations">
  expectedContextVersion: number
}) {
  const canAct = role === "owner" || role === "operator"
  const frozen = conversation.humanTakeover

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {frozen ? "Automation is frozen" : "Automation can work this thread"}
            {frozen && conversation.takeoverReason !== undefined ? (
              <Chip>{TAKEOVER_REASON_LABEL[conversation.takeoverReason]}</Chip>
            ) : null}
          </CardTitle>
          <CardDescription>
            {frozen
              ? "No new drafts and no sends while this holds. Freezing cannot recall mail already submitted to the provider."
              : "The squad may draft and — after your approval — send on this thread."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {frozen ? (
            <dl className="flex flex-col gap-1.5">
              {conversation.takeoverAt !== undefined ? (
                <DetailRow
                  label="Held since"
                  value={`${formatInstant(conversation.takeoverAt)} (${formatWaited(conversation.takeoverAt)})`}
                />
              ) : null}
              {conversation.takeoverBy !== undefined ? (
                <DetailRow
                  label="Held by"
                  value={
                    conversation.takeoverBy === "system"
                      ? "the system"
                      : conversation.takeoverBy
                  }
                />
              ) : null}
            </dl>
          ) : null}

          {canAct ? (
            <TakeoverControls
              workspaceId={workspaceId}
              conversation={conversation}
              expectedContextVersion={expectedContextVersion}
            />
          ) : (
            <PermissionNote
              role={role}
              action="take over, resume or close this conversation"
            />
          )}
        </CardContent>
      </Card>

      {conversation.state === "unassigned" ? (
        <AssociateCard
          workspaceId={workspaceId}
          role={role}
          conversation={conversation}
          expectedContextVersion={expectedContextVersion}
        />
      ) : null}

      {canAct ? (
        <AssignmentCard
          workspaceId={workspaceId}
          conversation={conversation}
          expectedContextVersion={expectedContextVersion}
        />
      ) : null}
    </div>
  )
}

/**
 * Take over / Resume / Close / Reopen. `enabled:false` is refused by the
 * backend by design — the only unfreeze is the checked `resume`, so the UI
 * offers exactly that shape and never a toggle that implies otherwise.
 */
function TakeoverControls({
  workspaceId,
  conversation,
  expectedContextVersion,
}: {
  workspaceId: Id<"workspaces">
  conversation: Doc<"conversations">
  expectedContextVersion: number
}) {
  const setTakeover = useMutation(api.inbox.conversationLifecycle.setTakeover)
  const resume = useMutation(api.inbox.conversationResume.resume)
  const close = useMutation(api.inbox.conversationLifecycle.close)
  const reopen = useMutation(api.inbox.conversationLifecycle.reopen)
  const intentId = useRequestIntents()

  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumeOutcome, setResumeOutcome] = useState<string | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [reason, setReason] = useState("")

  const run = (key: string, call: () => Promise<unknown>) => {
    setPending(key)
    setError(null)
    setResumeOutcome(null)
    void call()
      .catch((cause) => {
        setError(
          isConflictError(cause)
            ? `${errorMessage(cause, "This thread changed while you had it open.")} The page now shows the current version — review it before acting again.`
            : errorMessage(cause, "That change could not be applied."),
        )
      })
      .finally(() => setPending(null))
  }

  const doResume = () =>
    run("resume", async () => {
      const result = await resume({
        workspaceId,
        conversationId: conversation._id,
        expectedContextVersion,
        requestId: intentId(conversation._id, "resume"),
      })
      if (result.blockedBy !== undefined) {
        setResumeOutcome(resumeBlockLabel(result.blockedBy))
        return
      }
      if (result.dispatched) {
        toast.add({
          title: "Automation resumed",
          description:
            "The checks passed and a reply run started for the latest inbound message.",
          type: "success",
        })
      } else {
        setResumeOutcome(
          result.replyNote ??
            "Automation is re-armed. No reply work started — there may be no inbound message to answer.",
        )
      }
    })

  const frozen = conversation.humanTakeover
  const closed = conversation.state === "closed"
  const unassigned = conversation.state === "unassigned"

  return (
    <div className="flex flex-col gap-3">
      {!frozen && !closed ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="takeover-reason">
            Reason for taking over (optional)
          </Label>
          <Textarea
            id="takeover-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Talking to the prospect directly"
            maxLength={500}
            className="max-w-md"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!frozen && !closed ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending !== null}
            onClick={() =>
              run("takeover", () =>
                setTakeover({
                  workspaceId,
                  conversationId: conversation._id,
                  expectedContextVersion,
                  enabled: true,
                  ...(reason.trim().length > 0
                    ? { reason: reason.trim() }
                    : {}),
                }),
              )
            }
          >
            {pending === "takeover" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            Take over
          </Button>
        ) : null}

        {frozen && !closed ? (
          <Button
            size="sm"
            disabled={pending !== null}
            aria-describedby={
              unassigned ? "resume-needs-association" : undefined
            }
            onClick={doResume}
          >
            {pending === "resume" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            Resume automation
          </Button>
        ) : null}

        {!closed ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending !== null}
            onClick={() => setCloseOpen(true)}
          >
            Close conversation
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending !== null}
            onClick={() =>
              run("reopen", () =>
                reopen({
                  workspaceId,
                  conversationId: conversation._id,
                  expectedContextVersion,
                }),
              )
            }
          >
            {pending === "reopen" ? (
              <Spinner data-icon="inline-start" />
            ) : null}
            Reopen conversation
          </Button>
        )}
      </div>

      {unassigned ? (
        <p id="resume-needs-association" role="status" className="text-sm text-muted-foreground">
          Resume re-checks the lead link first — associate a lead below, then
          resume. A refused resume names the gate that is closed and keeps the
          hold on.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {frozen
            ? "Resume re-checks the lead link, the reply's sender, the agent's mode and the sending policy before anything is dispatched — a refusal names the closed gate and keeps the hold on."
            : "Takeover is immediate; resuming is a separate, checked act."}
        </p>
      )}

      {resumeOutcome !== null ? (
        <p role="status" className="text-sm text-foreground">
          {resumeOutcome}
        </p>
      ) : null}
      <FormError message={error} />

      {/* Close is reversible through Reopen, but it changes what automation
          may do — so it gets one explicit confirmation, not a silent click. */}
      <Dialog
        open={closeOpen}
        onOpenChange={(next) => {
          if (pending === null) {
            setCloseOpen(next)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Close this conversation</DialogTitle>
            <DialogDescription>
              A closed thread stays readable and automation refuses to work it.
              New mail on it does not reopen it — only a person can. You can
              reopen it later.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() => setCloseOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending !== null}
              onClick={() =>
                run("close", async () => {
                  await close({
                    workspaceId,
                    conversationId: conversation._id,
                    expectedContextVersion,
                  })
                  setCloseOpen(false)
                })
              }
            >
              {pending === "close" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Close it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Link an unassigned thread to a lead already in this workspace.
 *
 * Human-only by contract: the mutation accepts ids from an authenticated
 * editor, validates the lead is in this workspace and that it belongs to the
 * asserted agent — the picker derives `agentId` from the chosen lead so the
 * two can never disagree.
 */
function AssociateCard({
  workspaceId,
  role,
  conversation,
  expectedContextVersion,
}: {
  workspaceId: Id<"workspaces">
  role: WorkspaceRole
  conversation: Doc<"conversations">
  expectedContextVersion: number
}) {
  const prospects = useQuery(api.leads.queries.list, {
    workspaceId,
    limit: 50,
  })
  const associate = useMutation(api.inbox.conversationResume.associateProspect)
  const intentId = useRequestIntents()

  const [prospectId, setProspectId] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAct = role === "owner" || role === "operator"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link this thread to a lead</CardTitle>
        <CardDescription>
          This reply matched no thread, so nothing here has been worked. Linking
          a lead only files the conversation — it sends nothing and starts no
          work. Resuming automation is a separate, checked step afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {conversation.lastInboundFrom !== undefined ? (
          <DetailRow label="Reply came from" value={conversation.lastInboundFrom} />
        ) : null}

        {prospects === undefined ? (
          <LoadingState title="Loading leads" />
        ) : prospects.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This workspace has no leads to link yet — the sourcing pipeline
            creates them. The thread stays held here meanwhile.
          </p>
        ) : !canAct ? (
          <PermissionNote role={role} action="link this thread to a lead" />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="associate-prospect">Lead</Label>
              <NativeSelect
                id="associate-prospect"
                value={prospectId}
                onChange={(event) => setProspectId(event.target.value)}
              >
                <option value="">Choose a lead…</option>
                {prospects.items.map((prospect) => (
                  <option key={prospect._id} value={prospect._id}>
                    {[prospect.firstName, prospect.lastName]
                      .filter(
                        (part): part is string =>
                          part !== undefined && part.length > 0,
                      )
                      .join(" ") || "Name locked"}
                    {prospect.companyName === undefined
                      ? ""
                      : ` — ${prospect.companyName}`}{" "}
                    — {prospect.stage}
                  </option>
                ))}
              </NativeSelect>
              {prospects.hasMore ? (
                <p className="text-xs text-muted-foreground">
                  Showing the first {prospects.items.length} leads.
                </p>
              ) : null}
            </div>
            <div>
              <Button
                size="sm"
                disabled={pending || prospectId === ""}
                aria-describedby={
                  prospectId === "" ? "associate-needs-lead" : undefined
                }
                onClick={() => {
                  const prospect = prospects.items.find(
                    (item) => item._id === prospectId,
                  )
                  if (prospect === undefined) {
                    return
                  }
                  setPending(true)
                  setError(null)
                  void associate({
                    workspaceId,
                    conversationId: conversation._id,
                    expectedContextVersion,
                    prospectId: prospect._id,
                    agentId: prospect.agentId,
                    requestId: intentId(conversation._id, "associate"),
                  })
                    .then(() =>
                      toast.add({
                        title: "Lead linked",
                        description:
                          "The thread is filed under the lead. Automation stays frozen until you resume it.",
                        type: "success",
                      }),
                    )
                    .catch((cause) =>
                      setError(
                        isConflictError(cause)
                          ? `${errorMessage(cause, "This thread changed while you had it open.")} The page now shows the current version.`
                          : errorMessage(cause, "Could not link that lead."),
                      ),
                    )
                    .finally(() => setPending(false))
                }}
              >
                {pending ? <Spinner data-icon="inline-start" /> : null}
                Link the lead
              </Button>
              {prospectId === "" ? (
                <p
                  id="associate-needs-lead"
                  role="status"
                  className="mt-1 text-xs text-muted-foreground"
                >
                  Choose a lead first.
                </p>
              ) : null}
            </div>
          </>
        )}
        <FormError message={error} />
      </CardContent>
    </Card>
  )
}

/**
 * Two different assignments, kept visibly separate: the human OWNER of the
 * thread (`assigneeIdentityKey`, must be an active member).
 * The backend bumps `contextVersion` on
 * either change, which is why both take the pinned version.
 */
function AssignmentCard({
  workspaceId,
  conversation,
  expectedContextVersion,
}: {
  workspaceId: Id<"workspaces">
  conversation: Doc<"conversations">
  expectedContextVersion: number
}) {
  const members = useQuery(api.workspaces.queries.listMembers, { workspaceId })
  const assignOwner = useMutation(api.inbox.conversationLifecycle.assignOwner)

  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = (key: string, call: () => Promise<unknown>) => {
    setPending(key)
    setError(null)
    void call()
      .catch((cause) =>
        setError(
          isConflictError(cause)
            ? `${errorMessage(cause, "This thread changed while you had it open.")} The page now shows the current version.`
            : errorMessage(cause, "Could not change the assignment."),
        ),
      )
      .finally(() => setPending(null))
  }

  const activeMembers =
    members?.filter((member) => member.status === "active") ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ownership</CardTitle>
        <CardDescription>The person who owns this thread.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="conversation-owner">Human owner</Label>
          <NativeSelect
            id="conversation-owner"
            disabled={pending !== null || members === undefined}
            value={conversation.assigneeIdentityKey ?? ""}
            onChange={(event) =>
              run("assignOwner", () =>
                assignOwner({
                  workspaceId,
                  conversationId: conversation._id,
                  expectedContextVersion,
                  ...(event.target.value === ""
                    ? {}
                    : { assigneeIdentityKey: event.target.value }),
                }),
              )
            }
          >
            <option value="">No one assigned</option>
            {activeMembers.map((member) => (
              <option key={member._id} value={member.identityKey}>
                {member.identityKey.split("|").pop()} — {member.role}
              </option>
            ))}
          </NativeSelect>
        </div>
        <FormError message={error} />
      </CardContent>
    </Card>
  )
}
