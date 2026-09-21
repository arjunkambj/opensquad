import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** A flat block of a page: a heading, an optional one-line description and an action, split from its siblings by a rule instead of a card. */
export function PageSection({
  title,
  description,
  action,
  className,
  children,
}: {
  /** Omit for the first block on a page: the page title already names it. */
  title?: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      data-slot="page-section"
      className={cn(
        // Keyed on the marker rather than on `section`, so a framed panel next
        // to a section is not mistaken for a sibling section and ruled off.
        "flex flex-col gap-4 border-border [[data-slot=page-section]+&]:border-t [[data-slot=page-section]+&]:pt-6",
        className,
      )}
    >
      {title === undefined && description === undefined && action === undefined ? null : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title === undefined ? null : (
              <h2 className="text-base font-medium text-foreground">{title}</h2>
            )}
            {description === undefined ? null : (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {action === undefined ? null : <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** The frame every standalone table sits in, so tables never need a card around them. */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl bg-frame">{children}</div>
}
