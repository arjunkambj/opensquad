import { DEFAULT_INSTRUCTIONS_MAX_LENGTH } from "../../../../convex/lib/validators"
import { FormError } from "@/components/states/states"
import { Button } from "@/components/ui/button"
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
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel className="sr-only" htmlFor="outreach-default-instructions">
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
          className="text-right"
          id="outreach-default-instructions-count"
        >
          <span className={cn("tabular-nums", over && "text-destructive")}>
            {used} / {DEFAULT_INSTRUCTIONS_MAX_LENGTH}
          </span>
        </FieldDescription>
      </Field>

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
    </div>
  )
}
