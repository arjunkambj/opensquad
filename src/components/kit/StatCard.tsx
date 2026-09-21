/**
 * StatCard — one figure in the dashboard's top row (ref 20: Hot Opportunities,
 * Leads Engaged, Conversations, Pipeline generated).
 *
 * `value` is a node rather than a number so a screen can render an em dash for
 * "we cannot know this yet" (ref 20's Pipeline generated) without this
 * component inventing a zero. `loading` is a separate state for the same
 * reason: a figure still being counted must not look like a counted zero.
 */
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { Hint } from "@/components/kit/Hint"
import { Skeleton } from "@/components/ui/skeleton"

export type StatCardProps = {
  label: string
  icon?: IconSvgElement
  /** The figure, or a placeholder glyph when the caller has no number. */
  value: ReactNode
  /** Line under the figure, e.g. "Invitations sent". */
  sublabel?: ReactNode
  /** The window the figure covers. Shown on hover only: the page already
   *  says which window is picked, so five cards need not repeat it. */
  hint?: string
  /** Header slot, e.g. an Edit button. */
  action?: ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({
  label,
  icon,
  value,
  sublabel,
  hint,
  action,
  loading = false,
  className,
}: StatCardProps) {
  return (
    <FramedPanel
      as="div"
      title={<Hint content={hint}>{label}</Hint>}
      icon={icon}
      action={action}
      className={className}
      bodyClassName="gap-2 px-5 py-3"
    >
      {loading ? (
        <Skeleton shape="xl" className="h-9 w-20" />
      ) : (
        <p className="font-display text-4xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
          {value}
        </p>
      )}
      {sublabel ? (
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      ) : loading ? (
        // Holds the sublabel's line so the card keeps its loaded height.
        <div className="flex h-4 items-center">
          <Skeleton shape="full" className="h-3 w-32" />
        </div>
      ) : null}
    </FramedPanel>
  )
}
