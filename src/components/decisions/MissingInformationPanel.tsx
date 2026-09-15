import { useMutation } from "convex/react"
import { useState } from "react"
import { api } from "../../../convex/_generated/api"
import { DecisionActionDialog } from "@/components/decisions/DecisionActionDialog"
import type { DecisionPanelProps } from "@/components/decisions/decision-presentation"
import { humanizeFieldKey } from "@/components/decisions/decision-presentation"
import { useDecisionIntents } from "@/components/decisions/use-decision-intent"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { errorMessage, isConflictError } from "@/lib/convex-error"

type SubmittedAnswer = {
  body?: string
  fields?: Record<string, string>
}

/** Value equality over the parts this panel writes; key order cannot lie. */
function sameAnswer(
  recorded: SubmittedAnswer | undefined,
  sent: SubmittedAnswer,
): boolean {
  if (recorded === undefined) {
    return false
  }
  if ((recorded.body ?? "") !== (sent.body ?? "")) {
    return false
  }
  const recordedFields = Object.entries(recorded.fields ?? {}).sort()
  const sentFields = Object.entries(sent.fields ?? {}).sort()
  return (
    recordedFields.length === sentFields.length &&
    recordedFields.every(
      ([key, value], index) =>
        sentFields[index][0] === key && sentFields[index][1] === value,
    )
  )
}

/** The bounds `assertDecisionAnswer` enforces, mirrored on the client. */
const MAX_FIELD_VALUE = 2000
const MAX_BODY = 4000
const MAX_FIELDS = 20

/**
 * `missing_information` — one labelled input per requested field.
 *
 * This is the one kind that takes free text into the workflow, so it is also
 * the one kind where a client bound that disagrees with the server bound
 * produces a confusing failure after the reviewer has typed. The limits here
 * are the same limits `assertDecisionAnswer` applies.
 *
 * It resolves through `decisions.resolve`, which is correct for this kind and
 * for `connection_required` only — the two artifact-bound kinds refuse it.
 */
export function MissingInformationPanel({
  workspaceId,
  decision,
  expectedVersion,
  canAct,
  actionNotice,
}: DecisionPanelProps) {
  const resolve = useMutation(api.decisions.resolve)
  const intentId = useDecisionIntents()

  // Beyond 20 the backend refuses the whole answer; showing the extra inputs
  // would invite typing into a form that cannot be submitted.
  const requestedFields = (decision.requestedFields ?? []).slice(0, MAX_FIELDS)
  const usesFields = requestedFields.length > 0

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(requestedFields.map((field) => [field, ""])),
  )
  const [body, setBody] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filled = requestedFields.filter(
    (field) => (values[field] ?? "").trim().length > 0,
  )
  const overLong = requestedFields.some(
    (field) => (values[field] ?? "").trim().length > MAX_FIELD_VALUE,
  )
  const bodyTrimmed = body.trim()
  const valid = usesFields
    ? filled.length > 0 && !overLong
    : bodyTrimmed.length >= 1 && bodyTrimmed.length <= MAX_BODY

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const answer = usesFields
        ? {
            fields: Object.fromEntries(
              filled.map((field) => [field, values[field].trim()]),
            ),
            ...(bodyTrimmed.length === 0 ? {} : { body: bodyTrimmed }),
          }
        : { body: bodyTrimmed }
      const recorded = await resolve({
        workspaceId,
        decisionId: decision._id,
        expectedVersion,
        requestId: intentId(decision._id, "answer"),
        answer,
      })
      // A replayed requestId returns the answer that was actually written,
      // which may be an earlier submission whose response was lost. Saying
      // "recorded" for text that was not recorded is exactly the kind of lie
      // this screen exists to avoid, so compare and say which happened.
      if (!sameAnswer(recorded.answer, answer)) {
        setError(
          "An earlier submission of this same answer had already been recorded, so what you just typed was not saved. The recorded answer is shown on the decision above.",
        )
        return
      }
      toast.add({
        title: "Answer recorded",
        description: "The waiting work was signalled to continue.",
        type: "success",
      })
      setConfirming(false)
    } catch (cause) {
      setError(
        isConflictError(cause)
          ? `${errorMessage(cause, "This ask moved while you were answering it.")} Nothing was written and your answer is still here — review the ask above, which updates live, then submit again.`
          : errorMessage(cause, "Could not record that answer."),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>What the squad is missing</CardTitle>
          <CardDescription>
            {usesFields
              ? "Answer what you can. Fields left blank are not sent, so the workflow sees only what a human actually knew."
              : "This ask names no specific fields, so it takes one written answer."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {usesFields ? (
            requestedFields.map((field) => (
              <div key={field} className="flex flex-col gap-1.5">
                <Label htmlFor={`field-${field}`}>
                  {humanizeFieldKey(field)}
                </Label>
                <Input
                  id={`field-${field}`}
                  value={values[field] ?? ""}
                  maxLength={MAX_FIELD_VALUE}
                  disabled={!canAct}
                  onChange={(event) =>
                    setValues({ ...values, [field]: event.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Recorded under the key{" "}
                  <span className="font-mono">{field}</span>. Up to{" "}
                  {MAX_FIELD_VALUE} characters.
                </p>
              </div>
            ))
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="answer-body">
              {usesFields ? "Anything else (optional)" : "Your answer"}
            </Label>
            <Textarea
              id="answer-body"
              value={body}
              maxLength={MAX_BODY}
              disabled={!canAct}
              onChange={(event) => setBody(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {bodyTrimmed.length} / {MAX_BODY} characters.
            </p>
          </div>
        </CardContent>
      </Card>

      {actionNotice}
      {canAct ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button disabled={!valid} onClick={() => setConfirming(true)}>
              Submit answer
            </Button>
          </div>
          {valid ? null : (
            <p className="text-sm text-muted-foreground">
              {usesFields
                ? "Fill in at least one of the requested fields, within the character limit, before submitting."
                : "Write an answer before submitting."}
            </p>
          )}
        </div>
      ) : null}

      <DecisionActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Submit this answer"
        description="This resolves the ask and releases the work that was waiting on it. The answer is recorded against the decision permanently and cannot be edited afterwards."
        confirmLabel="Submit answer"
        confirmDisabled={!valid}
        busy={busy}
        error={error}
        onConfirm={() => void submit()}
      >
        <div className="flex flex-col gap-2 text-sm">
          {usesFields ? (
            filled.length === 0 ? (
              <p className="text-muted-foreground">No fields filled in.</p>
            ) : (
              filled.map((field) => (
                <p key={field} className="break-words">
                  <span className="text-muted-foreground">
                    {humanizeFieldKey(field)}:{" "}
                  </span>
                  {values[field].trim()}
                </p>
              ))
            )
          ) : null}
          {bodyTrimmed.length === 0 ? null : (
            <p className="break-words whitespace-pre-wrap">{bodyTrimmed}</p>
          )}
        </div>
      </DecisionActionDialog>
    </div>
  )
}
