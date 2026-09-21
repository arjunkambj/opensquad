import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

export type ReviewAccordionRow = {
  /** Stable key, also the accordion item's value. */
  id: string
  icon: IconSvgElement
  /** Field name; rendered uppercase. */
  label: string
  /** The current value in one line. */
  summary: ReactNode
  /** The editor for this field. Omit for a read-only row. */
  content?: ReactNode
}

export type ReviewAccordionProps = {
  rows: ReviewAccordionRow[]
  /** Ids open on first render. */
  defaultOpenIds?: string[]
  className?: string
}

export function ReviewAccordion({
  rows,
  defaultOpenIds,
  className,
}: ReviewAccordionProps) {
  return (
    <Accordion
      defaultValue={defaultOpenIds ?? []}
      className={cn("border-border bg-background", className)}
    >
      {rows.map((row) => (
        <AccordionItem
          key={row.id}
          value={row.id}
          disabled={row.content === undefined}
        >
          <AccordionTrigger className="items-center gap-4 px-4 py-3.5 hover:no-underline">
            <span className="flex min-w-0 items-center gap-3 text-left">
              <HugeiconsIcon
                icon={row.icon}
                strokeWidth={2}
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {row.label}
                </span>
                <span className="min-w-0 text-sm font-normal break-words text-foreground">
                  {row.summary}
                </span>
              </span>
            </span>
          </AccordionTrigger>
          {row.content === undefined ? null : (
            <AccordionContent>{row.content}</AccordionContent>
          )}
        </AccordionItem>
      ))}
    </Accordion>
  )
}
