/**
 * The section header card of reference 26: a tinted icon, the section's name,
 * one sentence saying what it controls, and the section's primary action on
 * the right.
 *
 * It carries the action rather than the card below it because the reference
 * puts the one thing you came to do at eye level, before the content it acts
 * on. Presentational — the caller keeps the mutation and the permission check,
 * and simply passes no `action` where the reader may not act.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type SectionHeaderCardProps = {
  icon: IconSvgElement
  title: string
  description: ReactNode
  /** The section's primary action, or nothing when there is none to offer. */
  action?: ReactNode
}

export function SectionHeaderCard({
  icon,
  title,
  description,
  action,
}: SectionHeaderCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        {action === undefined ? null : (
          <div className="shrink-0">{action}</div>
        )}
      </CardHeader>
    </Card>
  )
}
