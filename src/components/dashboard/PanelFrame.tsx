import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"

export function PanelFrame({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: IconSvgElement
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <HugeiconsIcon
              icon={icon}
              strokeWidth={2}
              className="size-4 text-primary"
              aria-hidden="true"
            />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-heading text-base font-semibold text-foreground">
              {title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
