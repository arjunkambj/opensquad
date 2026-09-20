/**
 * ChipInput — a list of removable chips followed by a dashed "+ Add" chip that
 * turns into an inline text field (refs 06 job titles, 07 "+ Add" inside a
 * filter group, 08 companies to avoid).
 *
 * Keyboard: Enter or comma commits, comma-separated paste commits each part,
 * Backspace on an empty field removes the last chip, Escape abandons the
 * draft. Duplicates are dropped case-insensitively and `maxCount` stops the
 * Add affordance rather than silently truncating a typed value.
 *
 * Data-free: `values` in, `onChange` out. It never seeds itself.
 */
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type ChipInputProps = {
  values: string[]
  onChange: (next: string[]) => void
  /** Accessible name for the inline text field. */
  inputAriaLabel: string
  /** Text on the dashed add chip. */
  addLabel?: string
  placeholder?: string
  /** Upper bound; the add chip disappears once reached. */
  maxCount?: number
  disabled?: boolean
  /** Coral outline (refs 06, 07) or neutral outline (ref 08). */
  tone?: "primary" | "neutral"
  /** Pill (refs 06, 08) or rounded rectangle, to match a chip group (ref 07). */
  shape?: "pill" | "rounded"
  /** Accessible name for a chip's remove button. */
  removeLabel?: (value: string) => string
  className?: string
}

function mergeValues(
  values: string[],
  raw: string,
  maxCount: number | undefined,
): string[] {
  const next = [...values]
  for (const part of raw.split(",")) {
    const candidate = part.trim()
    if (candidate.length === 0) {
      continue
    }
    if (maxCount !== undefined && next.length >= maxCount) {
      break
    }
    const lower = candidate.toLocaleLowerCase()
    if (next.some((value) => value.toLocaleLowerCase() === lower)) {
      continue
    }
    next.push(candidate)
  }
  return next
}

export function ChipInput({
  values,
  onChange,
  inputAriaLabel,
  addLabel = "Add",
  placeholder,
  maxCount,
  disabled = false,
  tone = "primary",
  shape = "pill",
  removeLabel = (value) => `Remove ${value}`,
  className,
}: ChipInputProps) {
  const [draft, setDraft] = useState("")
  const [isAdding, setIsAdding] = useState(false)

  const atMax = maxCount !== undefined && values.length >= maxCount
  const radius = shape === "pill" ? "rounded-full" : "rounded-xl"

  function commit(raw: string) {
    const next = mergeValues(values, raw, maxCount)
    if (next.length !== values.length) {
      onChange(next)
    }
    setDraft("")
  }

  function close() {
    setDraft("")
    setIsAdding(false)
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {values.map((value) => (
        <span
          key={value}
          className={cn(
            "inline-flex h-9 items-center gap-2 border px-4 text-sm",
            radius,
            tone === "primary"
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-border bg-background text-foreground",
          )}
        >
          {value}
          <button
            type="button"
            aria-label={removeLabel(value)}
            disabled={disabled}
            onClick={() => {
              onChange(values.filter((current) => current !== value))
            }}
            className="-mr-1 rounded-full p-1 outline-none transition-colors hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-3"
              aria-hidden="true"
            />
          </button>
        </span>
      ))}

      {isAdding ? (
        <Input
          // Mounted only when the user clicks Add, so taking focus is the
          // point rather than a surprise.
          autoFocus
          value={draft}
          aria-label={inputAriaLabel}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("h-9 w-52", radius)}
          onChange={(event) => {
            const raw = event.target.value
            if (raw.includes(",")) {
              commit(raw)
              return
            }
            setDraft(raw)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit(draft)
              return
            }
            if (event.key === "Escape") {
              event.preventDefault()
              close()
              return
            }
            if (
              event.key === "Backspace" &&
              draft.length === 0 &&
              values.length > 0
            ) {
              event.preventDefault()
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => {
            commit(draft)
            setIsAdding(false)
          }}
        />
      ) : atMax ? null : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setIsAdding(true)
          }}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 border border-dashed border-border px-4 text-sm text-muted-foreground outline-none transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            radius,
          )}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            strokeWidth={2}
            className="size-3.5"
            aria-hidden="true"
          />
          {addLabel}
        </button>
      )}
    </div>
  )
}
