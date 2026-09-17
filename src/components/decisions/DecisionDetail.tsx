import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import { ConnectionRequiredPanel } from "@/components/decisions/ConnectionRequiredPanel"
import { DeliveryUncertainPanel } from "@/components/decisions/DeliveryUncertainPanel"
import {
  DraftApprovalPanel,
  ExactContentCard,
} from "@/components/decisions/DraftApprovalPanel"
import { MissingInformationPanel } from "@/components/decisions/MissingInformationPanel"
import {
  DECISION_KIND_LABEL,
  DECISION_KIND_SUMMARY,
  DetailRow,
  KindChip,
  RequiredChip,
  RoleNote,
  StateChip,
  formatInstant,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import { useEscapeToParent } from "@/hooks/use-queue-navigation"
import type { WorkspaceRole } from "@/lib/workspace-role"

/**
 * Re-exported so the decision panels keep importing the name from here, while
 * the type itself has exactly one definition — the board and the mission
 * detail need the same role and a second `NonNullable<…>["role"]` would be a
 * second thing to keep in step.
 */
export type { WorkspaceRole }

/**
 * One decision, rendered by kind.
 *
 * The four kinds are four screens rather than one form with a switch in it,
 * because they are not variations of one ask: approving an email binds an
 * exact payload hash and schedules a send, answering a missing-information ask
 * writes free text into a workflow, a connection ask cannot be resolved by the
 * person most likely to be looking at it, and a delivery-uncertain ask exists
 * precisely because no action available here can establish the truth.
 */
export function DecisionDetail({ decisionId }: { decisionId: string }) {
  const current = useCurrentWorkspace()
  useEscapeToParent("/decisions")
  const headingRef = useRef<HTMLHeadingElement>(null)

  const decision = useQuery(
    api.decisions.get,
    current !== undefined && current !== null
      ? {
          workspaceId: current.workspace._id,
          decisionId: decisionId as Id<"decisions">,
        }
      : "skip",
  )

  // Focus lands on the heading when a decision opens — once per decision, not
  // on every live update, or a refresh would steal focus mid-review. The row
  // that opened it gets focus back on the way out (the queue tracks its id).
  const focusedFor = useRef<string | null>(null)
  useEffect(() => {
    if (decision !== undefined && focusedFor.current !== decisionId) {
      focusedFor.current = decisionId
      headingRef.current?.focus()
    }
  }, [decision, decisionId])

  if (current === undefined || current === null || decision === undefined) {
    return (
      <>
        <BackToQueue />
        <LoadingState
          title="Loading decision"
          description="Reading the ask and everything it is bound to."
        />
      </>
    )
  }

  return (
    <>
      <BackToQueue />
      <DecisionHeader decision={decision} headingRef={headingRef} />
      {decision.state === "open" ? (
        <OpenDecision
          workspaceId={current.workspace._id}
          timezone={current.workspace.timezone}
          role={current.role}
          decision={decision}
        />
      ) : (
        <ClosedDecision
          decision={decision}
          workspaceId={current.workspace._id}
        />
      )}
    </>
  )
}

function BackToQueue() {
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        render={<Link to="/decisions" search={(previous) => previous} />}
      >
        <HugeiconsIcon
          icon={ArrowLeft01Icon}
          strokeWidth={2}
          data-icon="inline-start"
          aria-hidden="true"
        />
        Back to decisions
      </Button>
    </div>
  )
}

function DecisionHeader({
  decision,
  headingRef,
}: {
  decision: Doc<"decisions">
  headingRef: RefObject<HTMLHeadingElement | null>
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <KindChip kind={decision.kind} />
        <StateChip state={decision.state} />
        <RequiredChip required={decision.required} />
        <span className="text-xs text-muted-foreground">
          opened {formatWaited(decision.createdAt)}
        </span>
      </div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-foreground outline-none"
      >
        {DECISION_KIND_LABEL[decision.kind]}
      </h1>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {DECISION_KIND_SUMMARY[decision.kind]}
      </p>
      <p className="max-w-3xl text-sm leading-relaxed text-foreground">
        {decision.reason}
      </p>
    </header>
  )
}

/**
 * A decision that is no longer open. It keeps its content readable and shows
 * the recorded outcome — who decided, when, and what they wrote — and it never
 * re-offers the buttons. Re-offering them would be the worst kind of lie this
 * screen can tell: an action that looks live and is not.
 */
function ClosedDecision({
  decision,
  workspaceId,
}: {
  decision: Doc<"decisions">
  workspaceId: Id<"workspaces">
}) {
  // The outcome alone does not answer the question this screen exists for:
  // WHICH bytes were approved. Drafts are immutable revisions, so a superseded
  // one stays readable — show the same exact-content card, without actions.
  const draftId = decision.draftId as Id<"drafts"> | undefined
  const draft = useQuery(
    api.drafts.get,
    draftId === undefined ? "skip" : { workspaceId, draftId },
  )
  const outcome: Record<Doc<"decisions">["state"], string> = {
    open: "",
    resolved: "This ask was answered. It is no longer waiting on anyone.",
    superseded:
      "This ask was superseded — the work it was bound to changed, so the backend retired it and opened a fresh ask on the new content. Look for the newer ask in this mission's queue.",
    cancelled:
      "This ask was cancelled. The work it was bound to is no longer running.",
  }

  return (
    <div className="flex flex-col gap-4">
      {draft === undefined ? null : <ExactContentCard draft={draft} />}
      <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Outcome</CardTitle>
        <CardDescription>{outcome[decision.state]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <DetailRow label="State" value={decision.state} />
        {decision.resolvedBy === undefined ? null : (
          <DetailRow label="Decided by" value={decision.resolvedBy} />
        )}
        {decision.resolvedAt === undefined ? null : (
          <DetailRow
            label="Decided at"
            value={formatInstant(decision.resolvedAt)}
          />
        )}
        {decision.answer?.approved === undefined ? null : (
          <DetailRow
            label="Approved"
            value={decision.answer.approved ? "yes" : "no"}
          />
        )}
        {decision.answer?.body === undefined ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Comment or reason
            </span>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {decision.answer.body}
            </p>
          </div>
        )}
        {decision.answer?.fields === undefined ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Answers given</span>
            {Object.entries(decision.answer.fields).map(([key, value]) => (
              <p key={key} className="text-sm text-foreground">
                <span className="text-muted-foreground">{key}: </span>
                {value}
              </p>
            ))}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
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
          Open this mission's queue
        </Button>
      </CardContent>
      </Card>
    </div>
  )
}

/**
 * The open case, with two gates in front of every kind panel.
 *
 * `reviewedVersion` is pinned to the version this reviewer actually saw, not
 * read live at click time. That is the point of an expected version: if the
 * ask moved underneath them, the write must fail rather than silently apply to
 * something they never read. When it does move we say so and make loading the
 * current version an explicit act.
 */
function OpenDecision({
  workspaceId,
  timezone,
  role,
  decision,
}: {
  workspaceId: Id<"workspaces">
  timezone: string
  role: WorkspaceRole
  decision: Doc<"decisions">
}) {
  const [reviewedVersion, setReviewedVersion] = useState(decision.version)

  const canEdit = role === "owner" || role === "operator"
  const stale = decision.version !== reviewedVersion

  const actionNotice: ReactNode = stale ? (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-border px-4 py-3">
      <p className="text-sm text-foreground">
        This ask changed while you had it open — it is now version{" "}
        {decision.version}, not {reviewedVersion}. Load it before deciding, so
        you are deciding on what is actually here.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setReviewedVersion(decision.version)}
      >
        Load the current version
      </Button>
    </div>
  ) : canEdit ? null : (
    <RoleNote action={actionForKind(decision.kind)} />
  )

  const shared = {
    workspaceId,
    decision,
    expectedVersion: reviewedVersion,
    canAct: canEdit && !stale,
    actionNotice,
  }

  switch (decision.kind) {
    case "draft_approval":
      return <DraftApprovalPanel {...shared} timezone={timezone} />
    case "missing_information":
      return <MissingInformationPanel {...shared} />
    case "connection_required":
      return <ConnectionRequiredPanel {...shared} role={role} />
    case "delivery_uncertain":
      return <DeliveryUncertainPanel {...shared} />
  }
}

function actionForKind(kind: Doc<"decisions">["kind"]): string {
  switch (kind) {
    case "draft_approval":
      return "approve this email, request changes or reject it"
    case "missing_information":
      return "answer this"
    case "connection_required":
      return "resolve this"
    case "delivery_uncertain":
      return "reconcile or resolve this"
  }
}
