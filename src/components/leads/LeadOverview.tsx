import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import {
  NEXT_ACTION_KINDS,
  SALES_STAGES,
  TERMINAL_SALES_STAGES,
} from "../../../convex/lib/validators"
import type { NextActionKind, SalesStage } from "../../../convex/lib/validators"
import {
  DetailRow,
  formatInstant,
  formatWaited,
} from "@/components/decisions/decision-presentation"
import {
  NEXT_ACTION_KIND_LABEL,
  SALES_STAGE_LABEL,
  memberLabel,
  nextActionLabel,
} from "@/components/leads/leads-presentation"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"
import { civilInputsInZone, civilTimeToUtcMs } from "@/lib/date-ranges"
import { useIntentId } from "@/lib/use-intent-id"
import { cn } from "@/lib/utils"

type LeadDetailResult = FunctionReturnType<typeof api.prospects.getDetail>

/**
 * The lead detail's working surface: the record's facts on the left and the
 * four write controls on the right. Every control submits the version the
 * operator SAW (`expectedVersion` pinned by `LeadDetail`), so a colleague's
 * change conflicts rather than landing silently — and the error it lands in
 * is inline, under the typed answer that survived (J7).
 *
 * `stale` never disables the controls — it must be possible to re-pin and
 * keep typing; the submit is what proves the version.
 */
export function LeadOverview({
  workspaceId,
  detail,
  campaign,
  expectedVersion,
  canEdit,
  stale,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  detail: LeadDetailResult
  campaign: FunctionReturnType<typeof api.campaigns.get> | undefined
  expectedVersion: number
  canEdit: boolean
  stale: boolean
  timezone: string
}) {
  const prospect = detail.prospect
  const next = nextActionLabel(
    prospect.nextAction,
    prospect.nextActionDueAt,
    timezone,
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <section
        aria-label="Lead facts"
        className="flex flex-col gap-4 rounded-xl bg-card p-5"
      >
        <h2 className="text-sm font-medium">The record</h2>
        <div className="flex flex-col gap-2">
          <DetailRow label="Company" value={prospect.companyName} />
          <DetailRow label="Domain" value={prospect.canonicalDomain} />
          <DetailRow
            label="Campaign"
            value={campaign?.title ?? "its campaign"}
          />
          {campaign !== undefined && campaign !== null ? (
            <DetailRow
              label="Campaign status"
              value={`${campaign.status} — ${campaign.leadLimit} lead${campaign.leadLimit === 1 ? "" : "s"} per campaign`}
            />
          ) : null}
          <DetailRow
            label="Qualification"
            value={prospect.qualification.replace("_", " ")}
          />
          <DetailRow
            label="Stage note"
            value={prospect.stageReason ?? "—"}
          />
          <DetailRow
            label="Owner"
            value={memberLabel(prospect.ownerIdentityKey)}
          />
          <DetailRow
            label="Last mailed"
            value={
              prospect.lastContactedAt === undefined
                ? "never — nothing sent has been accepted"
                : formatInstant(prospect.lastContactedAt, timezone)
            }
          />
          <DetailRow
            label="Last reply"
            value={
              prospect.lastReplyAt === undefined
                ? "no verified reply yet"
                : formatInstant(prospect.lastReplyAt, timezone)
            }
          />
          <DetailRow
            label="Added"
            value={formatInstant(prospect.createdAt, timezone)}
          />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">
            Why it fits
          </h3>
          <p className="text-sm leading-relaxed text-foreground">
            {prospect.fitReason}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            Where it was found ({prospect.sourceRefs.length} source
            {prospect.sourceRefs.length === 1 ? "" : "s"})
          </h3>
          <ul className="flex flex-col gap-1.5">
            {prospect.sourceRefs.map((ref, index) => (
              <li
                key={`${ref.source}:${ref.providerRecordId ?? ref.profileUrl ?? index}`}
                className="flex flex-col gap-0.5 rounded-lg bg-muted/60 px-3 py-2 text-xs"
              >
                <span className="font-medium text-foreground">
                  {ref.source}
                  {" — "}
                  <a
                    href={ref.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-normal underline underline-offset-2"
                  >
                    profile
                  </a>
                </span>
                <span className="text-muted-foreground">
                  found {formatWaited(ref.retrievedAt)}
                  {ref.providerRecordId !== undefined
                    ? ` · record ${ref.providerRecordId}`
                    : ""}
                  {ref.metric !== undefined
                    ? ` · ${ref.metric.name}: ${ref.metric.value}${ref.metric.currency !== undefined ? ` ${ref.metric.currency}` : ""}${ref.metric.period !== undefined ? `/${ref.metric.period}` : ""}`
                    : ""}
                </span>
              </li>
            ))}
            {prospect.sourceRefs.length === 0 ? (
              <li className="text-xs text-muted-foreground">
                No discovery sources are recorded — unusual; the Evidence tab
                shows what research found since.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            Contact
          </h3>
          {prospect.contact === undefined ? (
            <p className="text-sm text-muted-foreground">
              No enriched contact yet — enrichment lands here when the squad
              finds a verified person.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-foreground">
                {prospect.contact.fullName}
                {prospect.contact.role !== undefined
                  ? `, ${prospect.contact.role}`
                  : ""}
                {prospect.contact.providerEmailStatus === "verified" ? (
                  <span className="text-muted-foreground">
                    {" "}
                    (provider-verified)
                  </span>
                ) : null}
              </p>
              {prospect.contact.email !== undefined ? (
                <p className="text-sm text-muted-foreground">
                  {prospect.contact.email} — {prospect.contact.providerEmailStatus} via{" "}
                  {prospect.contact.source}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No usable address — {prospect.contact.providerEmailStatus}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Selected because: {prospect.contact.selectionReason} · retrieved{" "}
                {formatWaited(prospect.contact.retrievedAt)}
              </p>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex flex-col gap-1 rounded-lg px-3 py-2",
            next.overdue ? "bg-chart-1/10" : "bg-muted/60",
          )}
        >
          <h3 className="text-xs font-medium text-muted-foreground">
            Next action
          </h3>
          <p className="text-sm text-foreground">{next.text}</p>
        </div>
      </section>

      <section aria-label="Lead actions" className="flex flex-col gap-4">
        <StageControl
          workspaceId={workspaceId}
          prospectId={prospect._id}
          currentStage={prospect.salesStage}
          expectedVersion={expectedVersion}
          canEdit={canEdit}
          stale={stale}
        />
        <OwnerControl
          workspaceId={workspaceId}
          prospectId={prospect._id}
          currentOwner={prospect.ownerIdentityKey}
          expectedVersion={expectedVersion}
          canEdit={canEdit}
          stale={stale}
        />
        <NextActionControl
          workspaceId={workspaceId}
          prospectId={prospect._id}
          prospect={prospect}
          expectedVersion={expectedVersion}
          canEdit={canEdit}
          stale={stale}
          timezone={timezone}
        />
        <NoteControl
          workspaceId={workspaceId}
          prospectId={prospect._id}
          canEdit={canEdit}
          stale={stale}
        />
      </section>
    </div>
  )
}

/** One line under a read-only control — who can act, in words. */
function ReadOnlyNote({ action }: { action: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      You have read-only access to this workspace. An owner or operator can{" "}
      {action}.
    </p>
  )
}

/** The conflict line — the typed answer stays; nothing is cleared (J7). */
function mutationErrorMessage(error: unknown): string {
  if (isConflictError(error)) {
    return `${errorMessage(error, "The change conflicts with a newer version.")} Your entries above are unchanged — re-check the lead, then try again.`
  }
  return errorMessage(error, "The change could not be saved.")
}

/**
 * Stage transitions. `won`/`lost` are the two terminal calls a human makes,
 * so choosing one surfaces a required reason box before the submit is armed
 * — the backend demands it and the form must not be a trap (V15). Reverting
 * to any earlier stage is allowed; it is a human correction, not an undo.
 */
function StageControl({
  workspaceId,
  prospectId,
  currentStage,
  expectedVersion,
  canEdit,
  stale,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  currentStage: SalesStage
  expectedVersion: number
  canEdit: boolean
  stale: boolean
}) {
  const updateStage = useMutation(api.prospects.updateStage)
  const [requestId, rotateIntent] = useIntentId()
  const [target, setTarget] = useState<SalesStage>(currentStage)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const terminal = TERMINAL_SALES_STAGES.includes(currentStage)
  const targetTerminal = TERMINAL_SALES_STAGES.includes(target)
  // `reason` is REQUIRED by the backend on every human stage move — the
  // correction's basis is part of the record (§8), not an optional extra.
  const needsReason = target !== currentStage
  const canSubmit =
    canEdit &&
    !stale &&
    needsReason &&
    reason.trim().length > 0 &&
    !busy

  const submit = () => {
    if (!canSubmit) {
      return
    }
    setBusy(true)
    setError(null)
    void updateStage({
      workspaceId,
      prospectId,
      stage: target,
      reason: reason.trim(),
      expectedVersion,
      requestId,
    })
      .then(() => {
        toast.add({ title: `Stage moved to ${SALES_STAGE_LABEL[target]}`, type: "success" })
        setReason("")
        rotateIntent()
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-5">
      <h3 className="text-sm font-medium">Stage</h3>
      {terminal ? (
        <p className="text-xs text-muted-foreground">
          {SALES_STAGE_LABEL[currentStage]} is terminal — moving it is a
          deliberate human correction, recorded with the reason you give.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor="stage-target" className="text-xs text-muted-foreground">
            Move to
          </Label>
          <NativeSelect
            id="stage-target"
            value={target}
            disabled={!canEdit || busy}
            onChange={(event) => setTarget(event.target.value as SalesStage)}
          >
            {SALES_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {SALES_STAGE_LABEL[stage]}
                {stage === currentStage ? " (current)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          Move stage
        </Button>
      </div>
      {needsReason ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="stage-reason" className="text-xs text-muted-foreground">
            Basis for the move — required{targetTerminal ? ` (and kept on the ${SALES_STAGE_LABEL[target]} record)` : ""}
          </Label>
          <Textarea
            id="stage-reason"
            value={reason}
            rows={2}
            maxLength={200}
            placeholder={
              target === "won"
                ? "What was agreed — e.g. signed a contract for the redesign"
                : target === "lost"
                  ? "Why this lead is closed out — e.g. they went with a competitor"
                  : "What changed — e.g. they replied asking for a call"
            }
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}
      {stale ? (
        <p className="text-xs text-muted-foreground">
          The lead changed since you opened it — resolve the banner above
          before submitting.
        </p>
      ) : null}
      {!canEdit ? <ReadOnlyNote action="move the stage" /> : null}
      <FormError message={error} />
    </div>
  )
}

/**
 * Owner assignment. The picker lists ACTIVE members only; a revoked member's
 * leads still show their label in the read field, but nobody can be assigned
 * to a membership that cannot act on it.
 */
function OwnerControl({
  workspaceId,
  prospectId,
  currentOwner,
  expectedVersion,
  canEdit,
  stale,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  currentOwner: string
  expectedVersion: number
  canEdit: boolean
  stale: boolean
}) {
  const assign = useMutation(api.prospects.assign)
  const [requestId, rotateIntent] = useIntentId()
  const members = useQuery(api.workspaces.listMembers, { workspaceId })
  const active = (members ?? []).filter(
    (member) => member.status === "active",
  )
  // `assign` takes the membership row, not the identity key — the picker's
  // value is the membership id, and the current owner's membership is found
  // by matching the stored identity key back to a row.
  const currentMembership = active.find(
    (member) => member.identityKey === currentOwner,
  )

  // `null` is "untouched": `members` streams in after mount, so an untouched
  // pick follows the current owner's membership once it resolves instead of
  // stranding the select on a value that has no option to display.
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveTarget = target ?? currentMembership?._id ?? ""
  const targetMembership = active.find(
    (member) => member._id === effectiveTarget,
  )
  const canSubmit =
    canEdit &&
    !stale &&
    targetMembership !== undefined &&
    targetMembership.identityKey !== currentOwner &&
    !busy

  const submit = () => {
    if (!canSubmit || targetMembership === undefined) {
      return
    }
    setBusy(true)
    setError(null)
    void assign({
      workspaceId,
      prospectId,
      membershipId: targetMembership._id,
      expectedVersion,
      requestId,
    })
      .then(() => {
        toast.add({ title: `Owner is now ${memberLabel(targetMembership.identityKey)}`, type: "success" })
        rotateIntent()
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-5">
      <h3 className="text-sm font-medium">Owner</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor="owner-target" className="text-xs text-muted-foreground">
            Assigned to
          </Label>
          <NativeSelect
            id="owner-target"
            value={effectiveTarget}
            disabled={!canEdit || busy || members === undefined}
            onChange={(event) => setTarget(event.target.value)}
          >
            {/* The current owner always renders, even a revoked one — the
                select's value must name a real option, and a membership id
                is what `assign` consumes. While members are still loading
                the fallback names the state, not a revoked membership. */}
            {members === undefined ? (
              <option value="">Loading members…</option>
            ) : currentMembership === undefined ? (
              <option value="">
                {memberLabel(currentOwner)} (no longer a member)
              </option>
            ) : null}
            {active.map((member) => (
              <option key={member._id} value={member._id}>
                {memberLabel(member.identityKey)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          Assign
        </Button>
      </div>
      {stale ? (
        <p className="text-xs text-muted-foreground">
          The lead changed since you opened it — resolve the banner above
          before submitting.
        </p>
      ) : null}
      {!canEdit ? <ReadOnlyNote action="assign an owner" /> : null}
      <FormError message={error} />
    </div>
  )
}

/**
 * The next action + its due time. "Unscheduled" is a first-class choice —
 * clearing the date does not clear the action, and clearing the action is a
 * separate explicit button.
 *
 * The date input is a plain `datetime-local`-style pair (date + time) read in
 * the WORKSPACE timezone via `civilTimeToUtcMs` — the same zone every due
 * time on the page is printed in. An impossible or repeated wall time is
 * refused here before the backend ever sees it.
 */
function NextActionControl({
  workspaceId,
  prospectId,
  prospect,
  expectedVersion,
  canEdit,
  stale,
  timezone,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  prospect: LeadDetailResult["prospect"]
  expectedVersion: number
  canEdit: boolean
  stale: boolean
  timezone: string
}) {
  const setNextAction = useMutation(api.prospects.setNextAction)
  const [requestId, rotateIntent] = useIntentId()
  const [kind, setKind] = useState<NextActionKind>(
    prospect.nextAction?.kind ?? "review",
  )
  const [description, setDescription] = useState(
    prospect.nextAction?.description ?? "",
  )
  // Prefilled from the stored due instant on the workspace's wall clock, so
  // an untouched form submits nothing new — an empty start would silently
  // turn any "Save" into an unschedule.
  const storedDue =
    prospect.nextActionDueAt === undefined
      ? null
      : civilInputsInZone(prospect.nextActionDueAt, timezone)
  const [dueDate, setDueDate] = useState(storedDue?.date ?? "")
  const [dueTime, setDueTime] = useState(storedDue?.time ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A due time only parses when a DATE was typed; an empty date means
  // "unscheduled" (clear), not "invalid".
  const hasDueInput = dueDate !== ""
  const dueParsed = hasDueInput
    ? civilTimeToUtcMs(dueDate, dueTime === "" ? "09:00" : dueTime, timezone)
    : undefined
  const dueError =
    dueParsed === undefined
      ? null
      : !dueParsed.ok
        ? dueParsed.reason === "impossible_time"
          ? `That clock time does not exist in ${timezone} (a daylight-saving gap) — pick a different time.`
          : dueParsed.reason === "unreadable_zone"
            ? `${timezone} is not a timezone this browser knows.`
            : "Enter a valid date and time."
        : dueParsed.ambiguous
          ? `That clock time occurs twice in ${timezone} (a daylight-saving repeat) — pick a different time.`
          : null
  const dueMs =
    dueParsed !== undefined && dueParsed.ok && !dueParsed.ambiguous
      ? dueParsed.ms
      : undefined

  const hasAction = description.trim().length > 0
  // The date/time inputs express minutes only, so the comparison happens in
  // minute buckets — a stored instant's seconds must not read as a change.
  // Descriptions compare trimmed like the submit path writes them — a
  // whitespace-only edit must not arm Save for a semantic no-op.
  const storedDueMinute =
    prospect.nextActionDueAt === undefined
      ? undefined
      : Math.floor(prospect.nextActionDueAt / 60_000)
  const inputDueMinute =
    dueMs === undefined ? undefined : Math.floor(dueMs / 60_000)
  const changed =
    description.trim() !== (prospect.nextAction?.description ?? "") ||
    (hasAction &&
      prospect.nextAction !== undefined &&
      kind !== prospect.nextAction.kind) ||
    (hasAction && inputDueMinute !== storedDueMinute)
  const canSubmit = canEdit && !stale && changed && !busy && dueError === null

  const submit = () => {
    if (!canSubmit) {
      return
    }
    setBusy(true)
    setError(null)
    void setNextAction({
      workspaceId,
      prospectId,
      action: hasAction
        ? { kind, description: description.trim() }
        : null,
      ...(hasAction && dueMs !== undefined ? { dueAt: dueMs } : {}),
      expectedVersion,
      requestId,
    })
      .then(() => {
        toast.add({ title: hasAction ? "Next action updated" : "Next action cleared", type: "success" })
        rotateIntent()
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-5">
      <h3 className="text-sm font-medium">Next action</h3>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <Label htmlFor="na-kind" className="text-xs text-muted-foreground">
              Kind
            </Label>
            <NativeSelect
              id="na-kind"
              value={kind}
              disabled={!canEdit || busy}
              onChange={(event) =>
                setKind(event.target.value as NextActionKind)
              }
            >
              {NEXT_ACTION_KINDS.map((value) => (
                <option key={value} value={value}>
                  {NEXT_ACTION_KIND_LABEL[value]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="na-desc" className="text-xs text-muted-foreground">
            What needs doing — empty clears the action
          </Label>
          <Textarea
            id="na-desc"
            value={description}
            rows={2}
            maxLength={500}
            placeholder="e.g. Follow up on the proposal — they asked about pricing"
            disabled={!canEdit || busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="na-date" className="text-xs text-muted-foreground">
              Due date ({timezone})
            </Label>
            <Input
              id="na-date"
              type="date"
              value={dueDate}
              disabled={!canEdit || busy}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="na-time" className="text-xs text-muted-foreground">
              Time
            </Label>
            <Input
              id="na-time"
              type="time"
              value={dueTime}
              disabled={!canEdit || busy}
              onChange={(event) => setDueTime(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? <Spinner className="size-3.5" /> : null}
            Save action
          </Button>
        </div>
        {!hasAction && (dueDate !== "" || dueTime !== "") ? (
          <p className="text-xs text-destructive">
            A due date needs an action — the description above is empty, so
            saving would clear the action entirely.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {prospect.nextActionDueAt !== undefined
            ? `Currently due ${formatInstant(prospect.nextActionDueAt, timezone)} — leave the date empty to make it unscheduled.`
            : "No due date means unscheduled — it will not appear on the due list."}
        </p>
        {dueDate !== "" && dueTime === "" ? (
          <p className="text-xs text-muted-foreground">
            No time set — {`09:00 ${timezone}`} is used.
          </p>
        ) : null}
        {dueError !== null ? (
          <p className="text-xs text-destructive">{dueError}</p>
        ) : null}
        {stale ? (
          <p className="text-xs text-muted-foreground">
            The lead changed since you opened it — resolve the banner above
            before submitting.
          </p>
        ) : null}
        {!canEdit ? <ReadOnlyNote action="set the next action" /> : null}
        <FormError message={error} />
      </div>
    </div>
  )
}

/**
 * A note — append-only by design. The textarea is the whole surface; what a
 * person writes lands as a `note_added` lead event and is never editable
 * after the fact.
 */
function NoteControl({
  workspaceId,
  prospectId,
  canEdit,
  stale,
}: {
  workspaceId: Id<"workspaces">
  prospectId: Id<"prospects">
  canEdit: boolean
  stale: boolean
}) {
  const addNote = useMutation(api.prospects.addNote)
  const [requestId, rotateIntent] = useIntentId()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = canEdit && !stale && body.trim().length > 0 && !busy

  const submit = () => {
    if (!canSubmit) {
      return
    }
    setBusy(true)
    setError(null)
    // A note appends a lead event — there is no version to conflict on, so
    // the mutation takes no `expectedVersion` (unlike the field writes).
    void addNote({
      workspaceId,
      prospectId,
      body: body.trim(),
      requestId,
    })
      .then(() => {
        toast.add({ title: "Note added to the history", type: "success" })
        setBody("")
        rotateIntent()
      })
      .catch((failure: unknown) => setError(mutationErrorMessage(failure)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-5">
      <h3 className="text-sm font-medium">Add a note</h3>
      <Textarea
        aria-label="Note"
        value={body}
        rows={3}
        maxLength={1000}
        placeholder="Something a person knows that the record does not…"
        disabled={!canEdit || busy}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          Add note
        </Button>
        <p className="text-xs text-muted-foreground">
          Notes are append-only — they cannot be edited once added.
        </p>
      </div>
      {stale ? (
        <p className="text-xs text-muted-foreground">
          The lead changed since you opened it — resolve the banner above
          before submitting.
        </p>
      ) : null}
      {!canEdit ? <ReadOnlyNote action="add a note" /> : null}
      <FormError message={error} />
    </div>
  )
}
