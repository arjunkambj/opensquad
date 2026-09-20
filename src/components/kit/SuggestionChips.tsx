/**
 * SuggestionChips — the dashed "click to add" row under the keyword chips
 * (ref 10).
 *
 * Suggestions are offers, not state: they read as dashed outlines with a
 * leading plus so they never look like something already chosen. The caller
 * removes an accepted suggestion from the list, and `action` carries the
 * "Generate more" control so this component never asks for anything itself.
 */
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type SuggestionChipsProps = {
  /** The line above the chips, e.g. "AI-suggested — click to add". */
  label: string
  suggestions: string[]
  onAdd: (value: string) => void
  /** Right-aligned slot beside the label, e.g. a "Generate more" button. */
  action?: ReactNode
  disabled?: boolean
  className?: string
}

export function SuggestionChips({
  label,
  suggestions,
  onAdd,
  action,
  disabled = false,
  className,
}: SuggestionChipsProps) {
  if (suggestions.length === 0) {
    return null
  }
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
          {label}
        </p>
        {action}
      </div>
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap items-center gap-2"
      >
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => {
              onAdd(suggestion)
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-border px-3 text-sm text-foreground outline-none transition-colors hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              strokeWidth={2}
              className="size-3"
              aria-hidden="true"
            />
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  )
}
