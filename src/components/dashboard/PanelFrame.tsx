import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { FramedPanel } from "@/components/kit/FramedPanel"
import { Hint } from "@/components/kit/Hint"
import { Skeleton } from "@/components/ui/skeleton"

/** A dashboard list panel. Rows bring their own padding, so the body has none. */
export function PanelFrame({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: IconSvgElement
  title: string
  /** What the panel counts; shown on hover so the strip stays one line. */
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <FramedPanel
      icon={icon}
      title={<Hint content={description}>{title}</Hint>}
      action={action}
      bodyClassName="overflow-hidden p-0 py-1"
    >
      {children}
    </FramedPanel>
  )
}

/** Mirrors a panel row: a name over a detail line, and an optional trailing mark, at the row's own padding. */
export function PanelRowsSkeleton({
  rows = 3,
  trailing,
}: {
  rows?: number
  /** The right-hand mark each row carries; omit for none. */
  trailing?: "chip" | "score"
}) {
  return (
    <ul className="flex flex-col" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5 first:border-t-0"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex h-5 items-center">
              <Skeleton shape="full" className="h-3.5 w-32" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton shape="full" className="h-3 w-48 max-w-full" />
            </div>
          </div>
          {trailing === "chip" ? (
            <Skeleton shape="lg" className="h-6 w-20 shrink-0" />
          ) : trailing === "score" ? (
            <Skeleton shape="lg" className="h-4 w-14 shrink-0" />
          ) : null}
        </li>
      ))}
    </ul>
  )
}
