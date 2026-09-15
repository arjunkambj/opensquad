import { Link } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { DecisionActionDialog } from "@/components/decisions/DecisionActionDialog"
import type { DecisionPanelProps } from "@/components/decisions/decision-presentation"
import {
  Chip,
  DetailRow,
  attemptStateLabel,
  formatInstant,
  shortHash,
} from "@/components/decisions/decision-presentation"
import { useDecisionIntents } from "@/components/decisions/use-decision-intent"
import { ErrorState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"

/**
 * Preflight codes that mean the *approval itself* would be rejected, not that
 * the send would merely be deferred. Only these disable Approve: they are the
 * cases where `approvals.approve` re-checks the same fact and CONFLICTs, so
 * leaving the button live would be leaving a trap.
 *
 * Everything else — outside_window, send_limit_reached, suppressed_email,
 * workspace_paused — is a dispatch-time gate. The approval is still a valid
 * record of a human decision, so the code is explained beside a live button
 * rather than used to silently hide one.
 */
const APPROVAL_INVALIDATING_CODES: readonly string[] = [
  "draft_not_current",
  "context_changed",
]

type ActionKey = "approve" | "request_changes" | "reject"

/**
 * `draft_approval` — the exact-content contract.
 *
 * Everything here exists to make one sentence true: the bytes on screen are
 * the bytes that will be sent. The payload hash commits to exactly
 * `{ endpointOperation, inboxRef, normalizedRecipient, subject, body,
 * replyToMessageRef }`, so those are the fields shown as content, and the
 * *normalized* recipient is the one displayed — the as-typed form is not in
 * the hash and is shown only as a secondary note when it differs.
 */
export function DraftApprovalPanel({
  workspaceId,
  decision,
  expectedVersion,
  canAct,
  actionNotice,
  timezone,
}: DecisionPanelProps & { timezone: string }) {
  // `draftId` is a forward string reference in the schema, not an Id column.
  const draftId =
    decision.draftId === undefined
      ? undefined
      : (decision.draftId as Id<"drafts">)

  const draft = useQuery(
    api.drafts.get,
    draftId === undefined ? "skip" : { workspaceId, draftId },
  )
  const preflight = useQuery(
    api.sending.preflight,
    draftId === undefined ? "skip" : { workspaceId, draftId },
  )
  // Only needed to name the revision that replaced this one; skipped until
  // there is something to name.
  const revisions = useQuery(
    api.drafts.listForConversation,
    draft === undefined || draft.supersededAt === undefined
      ? "skip"
      : { workspaceId, conversationId: draft.conversationId, limit: 5 },
  )

  if (draftId === undefined) {
    return (
      <ErrorState
        title="This approval is not bound to a draft"
        description="The ask says an email needs approving but carries no draft reference, so there is no content to show and nothing that could be approved safely. This is a backend defect — report it rather than working around it."
      />
    )
  }

  if (draft === undefined || preflight === undefined) {
    return (
      <LoadingState
        title="Loading the exact draft"
        description="Reading the recipient, subject and body this approval would bind."
      />
    )
  }

  // An open draft_approval has no approval yet, and `no_current_approval` is
  // the gate `evaluateSendGates` reports before it ever reaches the window,
  // suppression or allowance checks. Treating it as a blocker would mark EVERY
  // decision on this screen "Blocked" with a code the reviewer cannot act on —
  // noise that teaches people to ignore the one card that warns them.
  const awaitingApproval =
    !preflight.permitted && preflight.code === "no_current_approval"
  const blockedCode =
    preflight.permitted || awaitingApproval ? undefined : preflight.code
  const supersededByRevision = revisions?.items.find(
    (item) => item.supersededAt === undefined,
  )
  const staleReason =
    draft.supersededAt !== undefined
      ? "A newer revision of this email exists, so this one is no longer the conversation's current draft."
      : blockedCode !== undefined &&
          APPROVAL_INVALIDATING_CODES.includes(blockedCode)
        ? "The conversation moved on since this draft was written — a reply, a takeover or a new revision advanced its context."
        : undefined

  return (
    <div className="flex flex-col gap-4">
      {staleReason === undefined ? null : (
        <Card className="max-w-3xl border border-dashed border-border">
          <CardHeader>
            <CardTitle>This draft is no longer current</CardTitle>
            <CardDescription>
              {staleReason} Approving would bind content that is already
              obsolete, so the actions below are switched off rather than left
              to fail at the server.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            {supersededByRevision === undefined ? null : (
              <p className="text-sm text-foreground">
                Revision {supersededByRevision.revision} is the current one.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              A revision retires its approval ask and opens a fresh one, so the
              live ask is a different decision with its own link.
            </p>
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/decisions"
                  search={(previous) => ({
                    ...previous,
                    mission: decision.missionId,
                    cursor: undefined,
                  })}
                />
              }
            >
              Open this mission's open asks
            </Button>
          </CardContent>
        </Card>
      )}

      <ExactContentCard draft={draft} />
      <PreflightCard
        preflight={preflight}
        awaitingApproval={awaitingApproval}
        timezone={timezone}
        blockedCode={blockedCode}
      />

      {actionNotice}
      {canAct ? (
        <DraftApprovalActions
          workspaceId={workspaceId}
          decision={decision}
          expectedVersion={expectedVersion}
          disabledReason={staleReason}
        />
      ) : null}
    </div>
  )
}

/**
 * The bytes, verbatim.
 *
 * `whitespace-pre-wrap` in a monospace block preserves every newline and every
 * run of spaces; nothing here trims, truncates, re-wraps at a sentence, or
 * interprets the body as markdown or HTML. What is displayed is what is
 * stored, which is what the hash commits to.
 */
export function ExactContentCard({ draft }: { draft: Doc<"drafts"> }) {
  const recipientDiffers = draft.recipient !== draft.normalizedRecipient

  return (
    <Card>
      <CardHeader>
        <CardTitle>The exact email</CardTitle>
        <CardDescription>
          Approving binds this revision's payload hash and the conversation
          context it was written against. These are the bytes that would be
          sent — nothing here is reformatted for display.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <p className="font-mono text-sm break-words text-foreground">
            {draft.normalizedRecipient}
          </p>
          {recipientDiffers ? (
            <p className="text-xs text-muted-foreground">
              Written as{" "}
              <span className="font-mono">{draft.recipient}</span>; the
              normalized address above is the one the hash and the send use.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Subject</span>
          <p className="font-mono text-sm break-words whitespace-pre-wrap text-foreground">
            {draft.subject}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Body</span>
          <pre className="max-h-[32rem] overflow-y-auto rounded-2xl bg-input/50 px-3 py-2 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">
            {draft.body}
          </pre>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <DetailRow label="Revision" value={draft.revision} />
          <DetailRow
            label="Payload hash"
            value={
              <span className="font-mono" title={draft.payloadHash}>
                {shortHash(draft.payloadHash)}
              </span>
            }
          />
          <DetailRow
            label="Operation"
            value={
              draft.replyToMessageRef === undefined
                ? "new message"
                : `reply to ${draft.replyToMessageRef}`
            }
          />
          <DetailRow label="Inbox" value={draft.inboxRef} />
          <DetailRow
            label="Written by"
            value={
              draft.createdBy === "workflow"
                ? "the squad"
                : `a human (${draft.createdBy})`
            }
          />
          <DetailRow
            label="Written at"
            value={formatInstant(draft.createdAt)}
          />
          <DetailRow
            label="Versions it was built on"
            value={`context ${draft.basedOnContextVersion} · brief ${draft.campaignBriefVersion} · policy ${draft.policyVersion}`}
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Evidence this was written from
            </span>
            {draft.evidenceIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No evidence records are attached to this revision.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {draft.evidenceIds.map((evidenceId) => (
                  <li key={evidenceId}>
                    <Chip className="font-mono">{evidenceId}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * What the send boundary can see right now.
 *
 * `sending.preflight` is a reactive query that grants nothing — every gate
 * re-runs at dispatch — so this card is written as information, never as
 * permission. It is the only way the reviewer learns before clicking that an
 * approval will sit behind a closed window or a suppressed address.
 */
function PreflightCard({
  preflight,
  timezone,
  blockedCode,
  awaitingApproval,
}: {
  preflight: {
    permitted: boolean
    code?: string
    reason?: string
    nextPermittedAt?: number
    attempts: {
      sendAttemptId: Id<"sendAttempts">
      state: Doc<"sendAttempts">["state"]
      resultCode: string
      createdAt: number
    }[]
  }
  timezone: string
  blockedCode: string | undefined
  /** The only "blocker" this screen's own outcome removes. */
  awaitingApproval: boolean
}) {
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Send checks</CardTitle>
        <CardDescription>
          Read-only. The send boundary re-runs every one of these when it
          actually dispatches, so a green check here is information, not
          permission.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {preflight.permitted ? (
          <p className="text-sm text-foreground">
            No blocker is visible right now.
          </p>
        ) : awaitingApproval ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-foreground">
              Not approved yet — which is what this screen is for.
            </p>
            <p className="text-sm text-muted-foreground">
              The send boundary stops at the approval check, so it has not yet
              evaluated the sending window, the daily allowance or the
              suppression list. Those are checked when the send is dispatched,
              and this card cannot preview them from here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-foreground">
              Blocked: {preflight.reason ?? "no reason given"}
            </p>
            {blockedCode === undefined ? null : (
              <p className="text-xs text-muted-foreground">
                Code <span className="font-mono">{blockedCode}</span>
              </p>
            )}
            {preflight.nextPermittedAt === undefined ? null : (
              <p className="text-sm text-muted-foreground">
                Not before {formatInstant(preflight.nextPermittedAt, timezone)}{" "}
                ({timezone}) — and every check runs again then.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Send attempts</span>
          {preflight.attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has been attempted for this revision.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {preflight.attempts.map((attempt) => (
                <li key={attempt.sendAttemptId} className="text-sm">
                  <span className="text-foreground">
                    {attemptStateLabel(attempt.state)}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatInstant(attempt.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Three distinct verdicts through three distinct mutations. They are not
 * collapsible: `approve` schedules the send, `requestChanges` tells the
 * pipeline to redraft, and `reject` is terminal for this revision — and the
 * backend records a different `draftResolution` for each.
 *
 * `decisions.resolve` is NOT used here. It refuses `draft_approval`
 * unconditionally, before any version check, because a bare answer would burn
 * the ask while writing no approvals row for the send boundary to honour.
 */
function DraftApprovalActions({
  workspaceId,
  decision,
  expectedVersion,
  disabledReason,
}: {
  workspaceId: Id<"workspaces">
  decision: Doc<"decisions">
  expectedVersion: number
  /**
   * Why acting is currently refused, or `undefined` when it is allowed. The
   * component stays MOUNTED and disables its buttons rather than being removed
   * by the caller: staleness arrives reactively, and unmounting would delete
   * the comment or reason the reviewer had already typed at the exact moment
   * the plan requires it preserved.
   */
  disabledReason: string | undefined
}) {
  const approve = useMutation(api.approvals.approve)
  const requestChanges = useMutation(api.approvals.requestChanges)
  const reject = useMutation(api.approvals.reject)
  const intentId = useDecisionIntents()

  const [open, setOpen] = useState<ActionKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Held here, outside the dialogs, so closing one or hitting a CONFLICT never
  // throws away what the reviewer wrote.
  const [comment, setComment] = useState("")
  const [changes, setChanges] = useState("")
  const [reason, setReason] = useState("")

  const run = async (action: ActionKey) => {
    setBusy(true)
    setError(null)
    try {
      const shared = {
        workspaceId,
        decisionId: decision._id,
        expectedVersion,
        requestId: intentId(decision._id, action),
      }
      if (action === "approve") {
        const trimmed = comment.trim()
        await approve({
          ...shared,
          ...(trimmed.length === 0 ? {} : { comment: trimmed }),
        })
        toast.add({
          title: "Approved",
          description: "A send was scheduled. Every check runs again at dispatch.",
          type: "success",
        })
      } else if (action === "request_changes") {
        await requestChanges({ ...shared, comment: changes.trim() })
        toast.add({
          title: "Changes requested",
          description: "The squad was asked to redraft this email.",
          type: "success",
        })
      } else {
        await reject({ ...shared, reason: reason.trim() })
        toast.add({
          title: "Rejected",
          description: "This revision will not be sent.",
          type: "success",
        })
      }
      setOpen(null)
    } catch (cause) {
      setError(
        isConflictError(cause)
          ? `${errorMessage(cause, "This ask moved while you were reading it.")} Nothing was written. Close this and review what is on the page now — it updates live.`
          : errorMessage(cause, "Could not record that decision."),
      )
    } finally {
      setBusy(false)
    }
  }

  const changesValid = boundedComment(changes)
  const reasonValid = boundedComment(reason)

  const blocked = disabledReason !== undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={blocked}
          aria-describedby={blocked ? "draft-actions-blocked" : undefined}
          onClick={() => setOpen("approve")}
        >
          Approve and send
        </Button>
        <Button
          variant="outline"
          disabled={blocked}
          aria-describedby={blocked ? "draft-actions-blocked" : undefined}
          onClick={() => setOpen("request_changes")}
        >
          Request changes
        </Button>
        <Button
          variant="destructive"
          disabled={blocked}
          aria-describedby={blocked ? "draft-actions-blocked" : undefined}
          onClick={() => setOpen("reject")}
        >
          Reject
        </Button>
      </div>
      {/* The reason a disabled control is disabled has to be readable, not
          inferable — and it is wired to the buttons so it is announced. */}
      {blocked ? (
        <p
          id="draft-actions-blocked"
          role="status"
          className="max-w-3xl text-sm text-muted-foreground"
        >
          {disabledReason} Anything you have typed is kept.
        </p>
      ) : null}
      <p className="max-w-3xl text-sm text-muted-foreground">
        Approving does not mark this reviewed — it schedules the send. Requesting
        changes asks the squad to redraft; rejecting ends this revision without
        a redraft. A note left elsewhere can never resolve this ask.
      </p>

      <DecisionActionDialog
        open={open === "approve"}
        onOpenChange={(next) => {
          setError(null)
          setOpen(next ? "approve" : null)
        }}
        title="Approve and send this email"
        description="This schedules the send immediately. The send boundary re-runs every check — window, suppression, daily limit, current revision — and will not send if any of them refuses, but no further human step stands between this button and the email leaving."
        confirmLabel="Approve and send"
        busy={busy}
        error={open === "approve" ? error : null}
        onConfirm={() => void run("approve")}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="approve-comment">Comment (optional)</Label>
          <Textarea
            id="approve-comment"
            value={comment}
            maxLength={2000}
            placeholder="Recorded on the approval, for whoever reads this later."
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </DecisionActionDialog>

      <DecisionActionDialog
        open={open === "request_changes"}
        onOpenChange={(next) => {
          setError(null)
          setOpen(next ? "request_changes" : null)
        }}
        title="Request changes"
        description="Nothing is sent. The ask is resolved as not approved and the squad is asked to write a new revision, which will arrive here as a fresh approval. Say what has to change."
        confirmLabel="Request changes"
        confirmDisabled={!changesValid}
        busy={busy}
        error={open === "request_changes" ? error : null}
        onConfirm={() => void run("request_changes")}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-changes-comment">
            What must change (required)
          </Label>
          <Textarea
            id="request-changes-comment"
            value={changes}
            maxLength={2000}
            onChange={(event) => setChanges(event.target.value)}
          />
          <CharacterCount value={changes} />
        </div>
      </DecisionActionDialog>

      <DecisionActionDialog
        open={open === "reject"}
        onOpenChange={(next) => {
          setError(null)
          setOpen(next ? "reject" : null)
        }}
        title="Reject this email"
        description="Nothing is sent and no redraft is requested. This is the terminal 'do not send this' verdict for this revision, and the reason is recorded permanently against it."
        confirmLabel="Reject"
        confirmVariant="destructive"
        confirmDisabled={!reasonValid}
        busy={busy}
        error={open === "reject" ? error : null}
        onConfirm={() => void run("reject")}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-reason">Reason (required)</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
          <CharacterCount value={reason} />
        </div>
      </DecisionActionDialog>
    </div>
  )
}

/** The same 1–2000 bound the backend enforces after trimming. */
function boundedComment(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 2000
}

function CharacterCount({ value, max = 2000 }: { value: string; max?: number }) {
  return (
    <p className="text-xs text-muted-foreground">
      {value.trim().length} / {max} characters
    </p>
  )
}
