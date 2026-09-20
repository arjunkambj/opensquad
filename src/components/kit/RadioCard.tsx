/**
 * RadioCard — one option of a single-choice set drawn as a card
 * (ref 05: Campaign Goal, Message Tone).
 *
 * It wraps a real `<input type="radio">` rather than a `role="radio"` button,
 * so arrow-key navigation, form semantics and the "one of `name` wins" rule
 * come from the browser instead of being re-implemented. The input is
 * visually hidden; the drawn dot mirrors its state, and the focus ring lives
 * on the card so keyboard users see what they are on.
 */
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
        "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        checked
          ? "border-primary bg-primary/5"
          : "border-border bg-background hover:bg-muted/60",
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
          checked ? "border-primary" : "border-border",
        )}
      >
        <span
          className={cn(
            "size-2 rounded-full transition-colors",
            checked ? "bg-primary" : "bg-transparent",
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
