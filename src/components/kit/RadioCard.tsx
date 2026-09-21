import { cn } from "@/lib/utils"

export type RadioCardProps = {
  /** Shared across the options of one choice — this is what groups them. */
  name: string
  value: string
  checked: boolean
  onSelect: (value: string) => void
  title: string
  description?: string
  disabled?: boolean
  className?: string
}

export function RadioCard({
  name,
  value,
  checked,
  onSelect,
  title,
  description,
  disabled = false,
  className,
}: RadioCardProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        checked
          ? "bg-accent"
          : "bg-muted/60 hover:bg-muted",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => {
          onSelect(value)
        }}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          checked ? "border-accent-foreground" : "border-muted-foreground/40",
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full transition-colors",
            checked ? "bg-accent-foreground" : "bg-transparent",
          )}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {description ? (
          <span className="text-sm text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
