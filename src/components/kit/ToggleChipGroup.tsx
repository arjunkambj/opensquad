/**
 * ToggleChipGroup — an uppercase group label over a wrap of toggle chips
 * (ref 07: INDUSTRY, LOCATION, COMPANY TYPES, COMPANY SIZE).
 *
 * The optional "All …" chip is exclusive: picking it clears the specific
 * choices, picking a specific one clears it, and clearing the last specific
 * choice falls back to it — so the group can never mean "nothing", which for
 * a lead filter would silently mean "everything".
 *
 * Data-free: options, selection and the callback all come from the caller.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type ToggleChipOption = {
  value: string
  label: string
}

export type ToggleChipGroupProps = {
  /** Group label; rendered uppercase. */
  label: string
  options: ToggleChipOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** The exclusive "All …" chip, rendered first. */
  allOption?: ToggleChipOption
  disabled?: boolean
  /** Trailing slot on the chip row — typically a `ChipInput` add chip. */
  children?: ReactNode
  className?: string
}

export function ToggleChipGroup({
  label,
  options,
  selected,
  onChange,
  allOption,
  disabled = false,
  children,
  className,
}: ToggleChipGroupProps) {
  const allValue = allOption?.value

  function toggle(value: string) {
    if (allValue !== undefined && value === allValue) {
      onChange([allValue])
      return
    }
    const specific = selected.filter((current) => current !== allValue)
    const next = specific.includes(value)
      ? specific.filter((current) => current !== value)
      : [...specific, value]
    if (next.length === 0 && allValue !== undefined) {
      onChange([allValue])
      return
    }
    onChange(next)
  }

  const chips = allOption ? [allOption, ...options] : options

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap items-center gap-2"
      >
        {chips.map((option) => {
          const isOn = selected.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isOn}
              disabled={disabled}
              onClick={() => {
                toggle(option.value)
              }}
              className={cn(
                "inline-flex h-9 items-center rounded-xl border px-4 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                isOn
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-background text-foreground hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          )
        })}
        {children}
      </div>
    </div>
  )
}
