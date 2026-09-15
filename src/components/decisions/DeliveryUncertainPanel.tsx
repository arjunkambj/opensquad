import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { DecisionActionDialog } from "@/components/decisions/DecisionActionDialog"
import type { DecisionPanelProps } from "@/components/decisions/decision-presentation"
import {
  DetailRow,
  attemptStateLabel,
  formatInstant,
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
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/convex-error"

const MAX_REASON = 2000

type UncertainAction = "reconcile" | "leave_unresolved" | "replace"

/**
 * `delivery_uncertain` — the ask that exists because nothing here can know.
 *
 * The transport died between "we handed this to the provider" and "we recorded
 * what the provider said". The email may have been delivered, or it may never
 * have left. No button on this page can determine which, and the one thing a
 * reviewer will instinctively reach for — send it again — is exactly the thing
 * that turns an unknown into a duplicate.
 *
 * So the order of the actions is the design: ask the provider first, record an
 * honest unknown second, and deliberately accept a possible duplicate third.
 */
export function DeliveryUncertainPanel({
  workspaceId,
  decision,
  expectedVersion,
  canAct,
  actionNotice,
}: DecisionPanelProps) {
  const attemptId =
    decision.sendAttemptId === undefined
      ? undefined
      : (decision.sendAttemptId as Id<"sendAttempts">)
  const draftId =
    decision.draftId === undefined
      ? undefined
      : (decision.draftId as Id<"drafts">)

  const attempts = useQuery(
    api.sendAttempts.listForDraft,
    draftId === undefined ? "skip" : { workspaceId, draftId },
  )
  const draft = useQuery(
    api.drafts.get,
    draftId === undefined ? "skip" : { workspaceId, draftId },
  )
  const revisions = useQuery(
    api.drafts.listForConversation,
    draft === undefined
      ? "skip"
      : { workspaceId, conversationId: draft.conversationId, limit: 10 },
  )

  const reconcile = useMutation(api.sending.requestReconciliation)
  const resolveUncertainty = useMutation(api.sending.resolveDeliveryUncertainty)
  const intentId = useDecisionIntents()

  const [open, setOpen] = useState<UncertainAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)

  if (attemptId === undefined || draftId === undefined) {
    return (
      <ErrorState
        title="This ask is not bound to a send attempt"
        description="A delivery-uncertain ask must name the attempt whose outcome is unknown and the draft it was sending. This one does not, so there is nothing safe to reconcile or replace. This is a backend defect — report it."
      />
    )
  }

  if (attempts === undefined || draft === undefined) {
    return (
      <LoadingState
        title="Loading the send attempt"
        description="Reading what was actually attempted and what the provider said."
      />
    )
  }

  const attempt = attempts.find((row) => row._id === attemptId)
  const replacement = revisions?.items.find(
    (item) => item.supersededAt === undefined,
  )
  const replacementIsNewer =
    replacement !== undefined && replacement._id !== draft._id

  const reasonTrimmed = reason.trim()
  const reasonValid =
    reasonTrimmed.length >= 1 && reasonTrimmed.length <= MAX_REASON

  const run = async (action: UncertainAction) => {
    setBusy(true)
    setError(null)
    try {
      if (action === "reconcile") {
        await reconcile({ workspaceId, sendAttemptId: attemptId })
        toast.add({
          title: "Reconciliation requested",
          description:
            "The provider will be asked what happened. This ask stays open until the answer lands or you resolve it.",
          type: "success",
        })
      } else {
        const result = await resolveUncertainty({
          workspaceId,
          decisionId: decision._id,
          expectedVersion,
          requestId: intentId(decision._id, action),
          reason: reasonTrimmed,
          ...(action === "replace" && replacement !== undefined
            ? {
                replacementDraftId: replacement._id,
                acknowledgeDuplicate: true,
              }
            : {}),
        })
        toast.add({
          title: "Recorded",
          description: result.dispatched
            ? "A replacement send was dispatched."
            : "The attempt stays uncertain, with your decision recorded against it.",
          type: "success",
        })
      }
      setOpen(null)
    } catch (cause) {
      // Every failure here is the world having moved — the attempt resolved
      // elsewhere, the window closed, the replacement is not current. The
      // backend's own sentence is the most accurate thing we can say.
      setError(errorMessage(cause, "Could not carry out that action."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>What is actually known</CardTitle>
          <CardDescription>
            The send request may have reached the provider, and may have been
            delivered. The connection failed before any result came back, so no
            action available here can determine which happened. Sending again is
            blocked for that reason, not as a precaution.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {attempt === undefined ? (
            <p className="text-sm text-muted-foreground">
              The attempt this ask names is not among this draft's attempts.
            </p>
          ) : (
            <>
              <DetailRow
                label="Attempt"
                value={attemptStateLabel(attempt.state)}
              />
              <DetailRow
                label="Started"
                value={formatInstant(
                  attempt.requestStartedAt ?? attempt.createdAt,
                )}
              />
              <DetailRow label="Operation" value={attempt.operationKey} />
              {attempt.providerMessageRef === undefined ? null : (
                <DetailRow
                  label="Provider reference"
                  value={attempt.providerMessageRef}
                />
              )}
              {attempt.reconciledAt === undefined ? null : (
                <DetailRow
                  label="Last reconciled"
                  value={formatInstant(attempt.reconciledAt)}
                />
              )}
              {attempt.error === undefined ? null : (
                <DetailRow
                  label="Recorded failure"
                  value={attempt.error.message}
                />
              )}
            </>
          )}
          <DetailRow label="Recipient" value={draft.normalizedRecipient} />
          <DetailRow label="Subject" value={draft.subject} />
          <DetailRow label="Revision" value={draft.revision} />
        </CardContent>
      </Card>

      {actionNotice}

      {canAct ? (
        <>
          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>1. Ask the provider first</CardTitle>
              <CardDescription>
                The safe move. It replays the original request under the same
                idempotency key, so the provider either reports the existing
                message or accepts it once — it cannot produce a second email.
                It does not resolve this ask: if the answer lands, the ask
                closes on its own; if it does not, this ask is still here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                The provider only honours the replay for a limited window after
                the original request. Once that window has closed the backend
                refuses this and says so — resolve the ask below instead.
              </p>
              <div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run("reconcile")}
                >
                  Ask the provider what happened
                </Button>
              </div>
              {open === null && error !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="max-w-3xl">
            <CardHeader>
              <CardTitle>2. Record it as unknown</CardTitle>
              <CardDescription>
                The honest close. The ask is resolved and the attempt stays{" "}
                <em>uncertain</em> permanently — that is the point: the record
                says a human reviewed an outcome nobody can establish. The
                attempt keeps holding its send reservation, so that slice of the
                daily allowance stays spent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => setOpen("leave_unresolved")}>
                Resolve as unknown
              </Button>
            </CardContent>
          </Card>

          <Card className="max-w-3xl border border-dashed border-destructive/40">
            <CardHeader>
              <CardTitle>3. Send a replacement</CardTitle>
              <CardDescription>
                The heavy option, and the only one that can deliver the same
                message twice. It dispatches the conversation's current revision
                as a new send covering this uncertain attempt. If the original
                did reach the recipient, they receive two emails.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* Loading is not an answer. `revisions` is skipped until the
                  draft resolves, so there is a render where the draft is here
                  and the revision list is not — and on the one path in this
                  product that can deliver a duplicate, "none available" must
                  never stand in for "still looking". */}
              {revisions === undefined ? (
                <p className="text-sm text-muted-foreground">
                  Checking whether the conversation has a current revision…
                </p>
              ) : replacement === undefined ? (
                <p className="text-sm text-muted-foreground">
                  No current revision is available to send as a replacement.
                </p>
              ) : (
                <>
                  <DetailRow
                    label="Would send"
                    value={`revision ${replacement.revision}${
                      replacementIsNewer
                        ? " — a newer revision than the uncertain one"
                        : " — the same revision that is uncertain"
                    }`}
                  />
                  <p className="text-sm text-muted-foreground">
                    The replacement must already carry its own live approval for
                    that exact content. If it does not, the backend refuses this
                    and says which condition failed — approve the current
                    revision first.
                  </p>
                  <Label className="items-start gap-2 text-sm font-normal">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(checked) =>
                        setAcknowledged(checked === true)
                      }
                      aria-label="Accept that this may deliver a duplicate"
                    />
                    <span className="text-muted-foreground">
                      I accept that {draft.normalizedRecipient} may receive this
                      message twice.
                    </span>
                  </Label>
                  <div>
                    <Button
                      variant="destructive"
                      disabled={!acknowledged}
                      onClick={() => setOpen("replace")}
                    >
                      Send a replacement
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <DecisionActionDialog
        open={open === "leave_unresolved"}
        onOpenChange={(next) => {
          setError(null)
          setOpen(next ? "leave_unresolved" : null)
        }}
        title="Resolve as unknown"
        description="Nothing is sent. The attempt stays uncertain forever and keeps its send reservation; this ask closes with your reason recorded as the human review of an outcome that cannot be established."
        confirmLabel="Resolve as unknown"
        confirmDisabled={!reasonValid}
        busy={busy}
        error={open === "leave_unresolved" ? error : null}
        onConfirm={() => void run("leave_unresolved")}
      >
        <ReasonField value={reason} onChange={setReason} />
      </DecisionActionDialog>

      <DecisionActionDialog
        open={open === "replace"}
        onOpenChange={(next) => {
          setError(null)
          setOpen(next ? "replace" : null)
        }}
        title="Send a replacement"
        description="This dispatches the current revision as a replacement for the uncertain attempt. If the original was delivered, the recipient gets the message twice. This authorization is consumed once and cannot be reused."
        confirmLabel="Send the replacement"
        confirmVariant="destructive"
        confirmDisabled={!reasonValid || !acknowledged}
        busy={busy}
        error={open === "replace" ? error : null}
        onConfirm={() => void run("replace")}
      >
        <ReasonField value={reason} onChange={setReason} />
        <p className="text-sm text-muted-foreground">
          Duplicate delivery accepted: {acknowledged ? "yes" : "no"}.
        </p>
      </DecisionActionDialog>
    </div>
  )
}

function ReasonField({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="uncertainty-reason">Reason (required)</Label>
      <Textarea
        id="uncertainty-reason"
        value={value}
        maxLength={MAX_REASON}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {value.trim().length} / {MAX_REASON} characters.
      </p>
    </div>
  )
}
