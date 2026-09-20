/**
 * StatCard — one figure in the dashboard's top row (ref 20: Hot Opportunities,
 * Leads Engaged, Conversations, Pipeline generated).
 *
 * `value` is a node rather than a number so a screen can render an em dash for
 * "we cannot know this yet" (ref 20's Pipeline generated) without this
 * component inventing a zero. `loading` is a separate state for the same
 * reason: a figure still being counted must not look like a counted zero.
 */
import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type StatCardProps = {
  label: string
  /** The figure, or a placeholder glyph when the caller has no number. */
  value: ReactNode
  /** Line under the figure, e.g. "Invitations sent". */
  sublabel?: string
  /** Muted line at the bottom, e.g. "Last 30 days". */
  hint?: string
  /** Top-right slot, e.g. an Edit button. */
  action?: ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  sublabel,
  hint,
  action,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-border bg-card px-5 py-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {action}
      </div>
      {loading ? (
        // bg-foreground/10 rather than the default bg-muted: the card's own
        // ground is muted on several themes, and an invisible skeleton reads
        // as a finished, empty figure.
        <Skeleton className="h-8 w-20 rounded-xl bg-foreground/10" />
      ) : (
        <p className="font-display text-3xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
          {value}
        </p>
      )}
      {sublabel ? (
        <p className="text-xs text-foreground">{sublabel}</p>
      ) : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
