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
