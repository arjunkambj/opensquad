/**
 * Onboarding dot 3, sub-step 2 — goals (reference 05, PLAN §11 M1).
 *
 * Three answers, one save: what the buyers struggle with, what the outreach
 * is for, and how it should read. The pain points are pre-filled from the
 * business profile the ICP step generated and stay fully editable, as every
 * generated field does (PLAN §5).
 *
 * The container: it owns the profile read and the save, and hands plain props
 * to the kit's radio cards.
 */
import { useMutation, useQuery } from "convex/react"
import { useState } from "react"
import type { ReactNode } from "react"
import { api } from "../../../../../convex/_generated/api"
import { RadioCard } from "@/components/kit/RadioCard"
import { EmptyState, FormError, LoadingState } from "@/components/states/states"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/convex-error"
import type { AgentGoal, AgentTone, OutreachStepProps } from "./outreach-step-model"
import {
  GOAL_OPTIONS,
  TONE_OPTIONS,
  pickChoice,
} from "./outreach-step-model"
import { OutreachStepShell } from "./OutreachStepShell"

/** Mirrors `COMPANY_PAIN_POINTS_MAX_LENGTH`, which validates the save. */
const PAIN_POINTS_MAX_LENGTH = 2_000

export function GoalsStep({
  orgId,
  agent,
  goNext,
  goBack,
}: OutreachStepProps) {
  const profile = useQuery(api.company.queries.get, { orgId })
  const save = useMutation(api.agents.outreachGoals.save)

  const [painPoints, setPainPoints] = useState<string | null>(null)
  const [goal, setGoal] = useState<AgentGoal>(agent.goal)
  const [tone, setTone] = useState<AgentTone>(agent.tone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `null` means "not edited yet", so the generated text keeps arriving from
  // the profile until the user takes the field over.
  const painPointsValue = painPoints ?? profile?.painPoints ?? ""

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      await save({ orgId, goal, tone, painPoints: painPointsValue })
      goNext()
    } catch (cause) {
      setError(
        errorMessage(cause, "We could not save your goals. Try again."),
      )
    } finally {
      setSaving(false)
    }
  }

  const shell = (children: ReactNode, ready: boolean) => (
    <OutreachStepShell
      step={2}
      title="Goals"
      description="We build your outreach around what you want from it and what your buyers actually struggle with."
      onPrevious={goBack}
      onNext={() => {
        void submit()
      }}
      nextDisabled={!ready || saving}
      nextLoading={saving}
    >
      {children}
    </OutreachStepShell>
  )

  if (profile === undefined) {
    return shell(
      <LoadingState
        title="Reading your company profile"
        description="Pulling in the pain points from your ICP."
      />,
      false,
    )
  }

  if (profile === null) {
    return shell(
      <EmptyState
        title="Your company profile is not saved yet"
        description="Go back to the company step and save it — the outreach is written from it."
      />,
      false,
    )
  }

  return shell(
    <div className="flex flex-col gap-8">
      <Field>
        <FieldLabel htmlFor="pain-points">Customers' pain points</FieldLabel>
        <Textarea
          id="pain-points"
          rows={3}
          maxLength={PAIN_POINTS_MAX_LENGTH}
          value={painPointsValue}
          disabled={saving}
          placeholder="What your buyers struggle with, in their words."
          onChange={(event) => {
            setPainPoints(event.target.value)
          }}
        />
        <FieldDescription>
          Every message opens from one of these, matched to the lead.
        </FieldDescription>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">
          Campaign goal
        </legend>
        {GOAL_OPTIONS.map((option) => (
          <RadioCard
            key={option.value}
            name="campaign-goal"
            value={option.value}
            checked={goal === option.value}
            disabled={saving}
            onSelect={(value) => {
              setGoal(pickChoice(GOAL_OPTIONS, value, goal))
            }}
            title={option.title}
            description={option.description}
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-foreground">
          Message tone
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TONE_OPTIONS.map((option) => (
            <RadioCard
              key={option.value}
              name="message-tone"
              value={option.value}
              checked={tone === option.value}
              disabled={saving}
              onSelect={(value) => {
                setTone(pickChoice(TONE_OPTIONS, value, tone))
              }}
              title={option.title}
              description={option.description}
            />
          ))}
        </div>
      </fieldset>

      <FormError message={error} />
    </div>,
    true,
  )
}
