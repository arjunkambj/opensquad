/**
 * The default-instructions editor (PLAN §1, "templates as one instructions
 * field").
 *
 * One bounded textarea with a live character count, because the value is
 * concatenated into every outreach prompt and a reader should be able to see
 * how close to the ceiling they are before the server refuses.
 *
 * Presentational: the container owns the value, the save and the permission.
 */
import { InformationCircleIcon } from "@hugeicons/core-free-icons"
import { DEFAULT_INSTRUCTIONS_MAX_LENGTH } from "../../../../convex/orgs/outreachDefaults"
import { InfoBanner } from "@/components/kit/InfoBanner"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type InstructionsEditorCardProps = {
  value: string
  onChange: (next: string) => void
  onSave: () => void
  onCancel: () => void
  dirty: boolean
  saving: boolean
  error: string | null
}

export function InstructionsEditorCard({
  value,
  onChange,
  onSave,
  onCancel,
  dirty,
  saving,
  error,
}: InstructionsEditorCardProps) {
  const used = value.trim().length
  const over = used > DEFAULT_INSTRUCTIONS_MAX_LENGTH

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="outreach-default-instructions">
            Default instructions
          </FieldLabel>
          <Textarea
            aria-describedby="outreach-default-instructions-count"
            className="min-h-48"
            id="outreach-default-instructions"
            placeholder="Keep it to four short sentences. Lead with the problem, never the product. Never claim a customer we don't have. Sign off as Sam."
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <FieldDescription
            className={cn(
              "flex items-center justify-between gap-3",
              over && "text-destructive",
            )}
            id="outreach-default-instructions-count"
          >
            <span>
              Rules about voice, length, what to claim and what never to say.
            </span>
            <span className="shrink-0 tabular-nums">
              {used} / {DEFAULT_INSTRUCTIONS_MAX_LENGTH}
            </span>
          </FieldDescription>
        </Field>

        <InfoBanner icon={InformationCircleIcon} title="These are a fallback.">
          An agent with its own instructions writes from those instead. These
          apply to every agent that has none of its own.
        </InfoBanner>

        <FormError message={error} />

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            disabled={saving}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={!dirty || over || saving}
            onClick={onSave}
            type="button"
          >
            {saving ? <Spinner data-icon="inline-start" /> : null}
            Save instructions
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
