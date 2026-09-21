/**
 * FramedPanel — the app's surface for figures and small panels: a frame-coloured
 * frame with a short header strip, around a white inner panel. Tables use the
 * same frame, so a page of KPIs and tables reads as one system.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function FramedPanel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = "section",
}: {
  title: ReactNode
  icon?: IconSvgElement
  /** Right side of the header strip: a small button or a muted note. */
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: "section" | "div"
}) {
  return (
    <Tag className={cn("flex flex-col rounded-2xl bg-frame p-0.75", className)}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 pr-1.5 pl-3.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
          {icon === undefined ? null : (
            <HugeiconsIcon
              icon={icon}
              strokeWidth={2}
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="truncate">{title}</span>
        </span>
        {action}
      </header>
      <div
        className={cn(
          "flex flex-1 flex-col rounded-xl bg-panel px-5 py-4",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </Tag>
  )
}
