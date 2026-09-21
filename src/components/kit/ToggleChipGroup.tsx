import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type ToggleChipOption = {
  value: string
  label: string
}

export type ToggleChipGroupProps = {
  /** Group label. */
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
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-sm font-medium text-foreground">
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
                "inline-flex h-8 items-center rounded-lg px-4 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                isOn
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
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
