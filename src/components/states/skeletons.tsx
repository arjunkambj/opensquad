/** Building blocks for route and section skeletons. Each mirrors the real
 * component it stands in for, so the page does not jump when data lands. */
import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** The live region every loading placeholder sits in. The label is for screen readers only. */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("flex min-w-0 flex-col gap-6", className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** Mirrors `DashboardPageTitle`. */
export function PageTitleSkeleton({
  description = true,
  actions = 0,
}: {
  description?: boolean
  /** How many action buttons sit on the right. */
  actions?: number
}) {
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton shape="xl" className="h-8 w-48" />
        {description ? <Skeleton shape="lg" className="h-5 w-72 max-w-full" /> : null}
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }, (_, index) => (
            <Skeleton key={index} shape="xl" className="h-8 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Mirrors the heading row of `PageSection`. */
export function SectionHeadingSkeleton({
  description = true,
  action = false,
}: {
  description?: boolean
  action?: boolean
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton shape="lg" className="h-6 w-40" />
        {description ? <Skeleton shape="lg" className="h-5 w-64 max-w-full" /> : null}
      </div>
      {action ? <Skeleton shape="xl" className="h-8 w-24" /> : null}
    </div>
  )
}

/** Mirrors `PageSection`: a heading row and a body, ruled off from the section above. */
export function SectionSkeleton({
  heading = true,
  description = true,
  action = false,
  className,
  children,
}: {
  heading?: boolean
  description?: boolean
  action?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-border [div+&]:border-t [div+&]:pt-6",
        className,
      )}
    >
      {heading ? (
        <SectionHeadingSkeleton description={description} action={action} />
      ) : null}
      {children}
    </div>
  )
}

/** A row of pill filters or tabs. */
export function PillsSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  const widths = ["w-20", "w-24", "w-16", "w-28", "w-20", "w-24"]
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={widths[index % widths.length]}>
          <Skeleton shape="xl" className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

/** Mirrors a `TableFrame` table: a header row and body rows at the table's own heights. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  const widths = ["w-40", "w-24", "w-32", "w-20", "w-28", "w-16"]
  return (
    <div className={cn("overflow-hidden rounded-2xl bg-frame", className)}>
      <div className="flex h-8 items-center gap-6 border-b border-border px-4">
        {Array.from({ length: columns }, (_, column) => (
          <div
            key={column}
            className={cn(column === 0 ? "w-24" : "w-16", column > 1 && "max-sm:hidden")}
          >
            <Skeleton shape="full" className="h-3 w-full" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex h-10 items-center gap-6 border-b border-frame px-4 last:border-b-0"
        >
          {Array.from({ length: columns }, (_, column) => (
            <div
              key={column}
              className={cn(
                widths[(row + column) % widths.length],
                column === 0 && "max-w-56 flex-1",
                column > 1 && "max-sm:hidden",
              )}
            >
              <Skeleton shape="full" className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** A card surface with a title and a few lines, for card-shaped sections. */
export function CardSkeleton({
  lines = 3,
  className,
  children,
}: {
  lines?: number
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-card bg-card p-6", className)}>
      <Skeleton shape="lg" className="h-5 w-40" />
      {children ?? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: lines }, (_, index) => (
            <div key={index} className={index === lines - 1 ? "w-3/5" : "w-full"}>
              <Skeleton shape="full" className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A labelled form field: label line over an input. */
export function FieldSkeleton({
  tall = false,
  className,
}: {
  tall?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Skeleton shape="full" className="h-3.5 w-28" />
      <Skeleton shape="xl" className={tall ? "h-24 w-full" : "h-8 w-full"} />
    </div>
  )
}

/** Stacked list rows, e.g. a feed or a short list inside a card. */
export function ListSkeleton({
  rows = 3,
  avatar = false,
  className,
}: {
  rows?: number
  avatar?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          {avatar ? <Skeleton shape="full" className="size-8 shrink-0" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton shape="full" className="h-3.5 w-2/5" />
            <Skeleton shape="full" className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
