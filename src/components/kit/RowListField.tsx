/**
 * RowListField — a labelled list of short lines, each on its own row with a
 * delete button, followed by one "add" row (reference 02: Key features, Social
 * Proof).
 *
 * A row list rather than `ChipInput`: these lines are sentences, not tags, and
 * the reference gives each one a full-width field it can be edited in place.
 *
 * Data-free: `values` in, `onChange` out.
 */
import { Delete02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type RowListFieldProps = {
  label: string
  /** Shows the required marker and is announced on every row. */
  required?: boolean
  values: string[]
  onChange: (next: string[]) => void
  /** Placeholder on the add row, e.g. "Add a key feature…". */
  addPlaceholder: string
  /** Accessible name for one existing row, e.g. `Key feature 2`. */
  rowLabel: (index: number) => string
  /** Accessible name for a row's delete button. */
  removeLabel: (index: number) => string
  /** Upper bound; the add row disappears once it is reached. */
  maxCount?: number
  disabled?: boolean
  description?: string
  className?: string
}

export function RowListField({
  label,
  required = false,
  values,
  onChange,
  addPlaceholder,
  rowLabel,
  removeLabel,
  maxCount,
  disabled = false,
  description,
  className,
}: RowListFieldProps) {
  const labelId = useId()
  const [draft, setDraft] = useState("")
  const full = maxCount !== undefined && values.length >= maxCount

  const commit = () => {
    const entry = draft.trim()
    if (entry.length === 0 || full) {
      return
    }
    onChange([...values, entry])
    setDraft("")
  }

  return (
    <Field className={className}>
      <FieldTitle className="gap-1" id={labelId}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        ) : null}
      </FieldTitle>

      <ul aria-labelledby={labelId} className="flex flex-col gap-2">
        {values.map((value, index) => (
          <li
            // Index-keyed on purpose: the rows are free text a user edits in
            // place, so two identical lines must stay two separate fields.
            key={index}
            className="flex items-center gap-2"
          >
            <Input
              aria-label={rowLabel(index)}
              className="h-10"
              disabled={disabled}
              value={value}
              onChange={(event) => {
                const next = [...values]
                next[index] = event.target.value
                onChange(next)
              }}
            />
            <Button
              aria-label={removeLabel(index)}
              disabled={disabled}
              onClick={() => {
                onChange(values.filter((_, at) => at !== index))
              }}
              size="icon"
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
            >
              <HugeiconsIcon
                icon={Delete02Icon}
                strokeWidth={2}
                aria-hidden="true"
              />
            </Button>
          </li>
        ))}
      </ul>

      {full ? null : (
        <div className={cn("flex items-center gap-2", values.length > 0 && "mt-2")}>
          <Input
            aria-label={addPlaceholder}
            className="h-10"
            disabled={disabled}
            placeholder={addPlaceholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commit()
              }
            }}
          />
          <Button
            disabled={disabled || draft.trim().length === 0}
            onClick={commit}
            type="button"
            variant="outline"
          >
            Add
          </Button>
        </div>
      )}

      {description !== undefined ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}
