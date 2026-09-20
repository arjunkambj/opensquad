import { useState } from "react"
import { FormError } from "@/components/states/states"
import {
  type CampaignScopeForm,
  campaignFormProblems,
} from "@/components/onboarding/onboarding-model"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/**
 * Step 3 — campaign basics. Nothing is persisted here: the campaign is created
 * only at the review step's explicit confirmation (`campaigns.create`), so
 * editing and re-editing this step can never pile up unconfirmed drafts.
 */
export function CampaignStep({
  form,
  onChange,
  onDone,
}: {
  form: CampaignScopeForm
  onChange: (next: CampaignScopeForm) => void
  onDone: () => void
}) {
  const [errors, setErrors] = useState<string[]>([])

  const update = (patch: Partial<CampaignScopeForm>) =>
    onChange({ ...form, ...patch })

  const next = () => {
    const problems = campaignFormProblems(form)
    if (problems.length > 0) {
      setErrors(problems)
      return
    }
    setErrors([])
    onDone()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign scope</CardTitle>
        <CardDescription>
          What this campaign is for and how much it may spend. Nothing runs yet
          — you confirm it on the next step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="camp-title">Campaign title</FieldLabel>
            <Input
              id="camp-title"
              placeholder="e.g. September agency outreach"
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="camp-brief">Brief</FieldLabel>
            <Textarea
              id="camp-brief"
              placeholder="What should this campaign achieve? Context the agent works from."
              value={form.brief}
              onChange={(event) => update({ brief: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="camp-enrichment">
              Enrichment allowance
            </FieldLabel>
            <Input
              id="camp-enrichment"
              type="number"
              min={0}
              max={10}
              step={1}
              value={form.enrichmentLimit}
              onChange={(event) =>
                update({ enrichmentLimit: event.target.value })
              }
            />
            <FieldDescription>
              Paid contact-enrichment operations this campaign may use (0–10).
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Prospect cap</FieldLabel>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[String(form.leadLimit)]}
              onValueChange={(next) => {
                const value = Number(next[0])
                if (Number.isInteger(value) && value >= 1 && value <= 5) {
                  update({ leadLimit: value })
                }
              }}
            >
              {[1, 2, 3, 4, 5].map((count) => (
                <ToggleGroupItem key={count} value={String(count)}>
                  {count}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              At most this many accepted prospects (1–5 for MVP).
            </FieldDescription>
          </Field>

          {errors.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1">
              {errors.map((problem) => (
                <FormError key={problem} message={problem} />
              ))}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button onClick={next}>Review plan</Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
