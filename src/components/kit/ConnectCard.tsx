/**
 * ConnectCard — one channel offer on the connect-accounts step (ref 04).
 *
 * Title, an optional "Recommended" tag, what connecting buys you as ticked
 * bullets, and the action. `action` and `secondaryAction` are slots, not
 * labels, because the connect button carries the provider's own branding and
 * the OAuth call belongs to the page, not to a presentational card.
 */
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type ConnectCardProps = {
  /** Brand mark slot, rendered before the title. */
  icon?: ReactNode
  title: string
  /** Small pill beside the title, e.g. "Recommended". */
  tag?: string
  /** What connecting buys you, one line each. */
  benefits: string[]
  /** The primary connect control. */
  action: ReactNode
  /** The "Connect later" escape hatch. */
  secondaryAction?: ReactNode
  className?: string
}

export function ConnectCard({
  icon,
  title,
  tag,
  benefits,
  action,
  secondaryAction,
  className,
}: ConnectCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-border bg-background p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {icon ? <span className="flex shrink-0 items-center">{icon}</span> : null}
        <h3 className="font-heading text-base font-semibold text-foreground">
          {title}
        </h3>
        {tag ? (
          <span className="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary">
            {tag}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-sm">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={2}
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="min-w-0 text-foreground">{benefit}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-2">
        {action}
        {secondaryAction}
      </div>
    </div>
  )
}
