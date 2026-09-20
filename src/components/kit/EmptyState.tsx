/**
 * EmptyState — the centred "nothing here yet, here is what to do" block
 * (ref 26: "No custom templates yet").
 *
 * Empty is a designed state, not a blank area: an icon or illustration, what
 * is missing, why it matters, and the one action that fills it. The action is
 * a slot so the caller keeps the mutation and the permission check.
 *
 * `src/components/states/states.tsx` has a dashed-border variant of this used
 * by the pre-pivot screens; this one is the card-interior form the reference
 * screenshots use.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type EmptyStateProps = {
  /** A Hugeicon for the standard treatment. */
  icon?: IconSvgElement
  /** A richer illustration, used instead of `icon` when given. */
  illustration?: ReactNode
  title: string
  description?: ReactNode
  /** The one thing to do next. */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      {illustration ??
        (icon ? (
          <HugeiconsIcon
            icon={icon}
            strokeWidth={1.5}
            className="size-9 text-muted-foreground"
            aria-hidden="true"
          />
        ) : null)}
      <p className="font-heading text-base font-semibold text-foreground">
        {title}
      </p>
      {description ? (
        <div className="max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
