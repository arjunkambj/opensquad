/**
 * AiGeneratedBadge — the pill in the top-left of every pre-filled onboarding
 * card (refs 06, 07, 08, 09, 10).
 *
 * It says one thing: what is below was written for you, and you can change it.
 * When `onEdit` is given the pencil becomes a real button; without it the
 * badge is a plain label, because a pencil that does nothing is a lie.
 */
import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@/lib/utils"

export type AiGeneratedBadgeProps = {
  /** Badge text, e.g. "AI-generated". */
  label: string
  /** When given, renders the pencil as a button that calls this. */
  onEdit?: () => void
  /** Accessible name for the pencil button. */
  editLabel?: string
  className?: string
}

export function AiGeneratedBadge({
  label,
  onEdit,
  editLabel = "Edit",
  className,
}: AiGeneratedBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg bg-linear-to-r from-primary to-primary/70 px-3 py-1 text-xs font-medium text-primary-foreground",
        className,
      )}
    >
      {label}
      {onEdit ? (
        <button
          type="button"
          aria-label={editLabel}
          onClick={onEdit}
          className="-mr-0.5 rounded-full p-0.5 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary-foreground/70"
        >
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            strokeWidth={2}
            className="size-3"
            aria-hidden="true"
          />
        </button>
      ) : null}
    </span>
  )
}
