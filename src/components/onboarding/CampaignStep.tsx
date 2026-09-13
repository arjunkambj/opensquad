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
 * Step 3 — campaign scope. Nothing is persisted here: the campaign is created
 * only at the review step's explicit confirmation (`campaigns.create` →
 * `campaigns.confirmSourcePlan`), so editing and re-editing this step can never
 * pile up unconfirmed drafts.
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
          What Scout should find and how much it may spend doing it. Nothing
          runs yet — you confirm the interpreted plan on the next step.
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
              placeholder="What should this campaign achieve? Context employees work from."
              value={form.brief}
              onChange={(event) => update({ brief: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="camp-instruction">
              Source instruction
            </FieldLabel>
            <Textarea
              id="camp-instruction"
              placeholder="Describe where to look, in your own words — e.g. Apollo companies in the US mid-market agency space."
              value={form.instruction}
              onChange={(event) =>
                update({ instruction: event.target.value })
              }
            />
            <FieldDescription>
              Stored verbatim next to the typed interpretation below.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Source: Apollo company search</FieldLabel>
            <FieldDescription>
              Apollo is the only provider route enabled today — YC and TrustMRR
              stay unavailable until their extraction gates pass, and the
              backend rejects plans that include them.
            </FieldDescription>
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="camp-locations">Locations</FieldLabel>
              <Input
                id="camp-locations"
                placeholder="e.g. United States, Canada"
                value={form.locations}
                onChange={(event) =>
                  update({ locations: event.target.value })
                }
              />
              <FieldDescription>Comma-separated, optional.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="camp-categories">Categories</FieldLabel>
              <Input
                id="camp-categories"
                placeholder="e.g. marketing, advertising"
                value={form.categories}
                onChange={(event) =>
                  update({ categories: event.target.value })
                }
              />
              <FieldDescription>Comma-separated, optional.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="camp-emp-min">Employees (min)</FieldLabel>
              <Input
                id="camp-emp-min"
                type="number"
                min={1}
                placeholder="e.g. 5"
                value={form.employeeMin}
                onChange={(event) =>
                  update({ employeeMin: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="camp-emp-max">Employees (max)</FieldLabel>
              <Input
                id="camp-emp-max"
                type="number"
                min={1}
                placeholder="e.g. 50"
                value={form.employeeMax}
                onChange={(event) =>
                  update({ employeeMax: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="camp-max-results">
                Max results per source
              </FieldLabel>
              <Input
                id="camp-max-results"
                type="number"
                min={1}
                max={25}
                placeholder="up to 25"
                value={form.maxResults}
                onChange={(event) =>
                  update({ maxResults: event.target.value })
                }
              />
              <FieldDescription>
                Optional bound on candidates Scout may pull (1–25).
              </FieldDescription>
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
          </div>

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
