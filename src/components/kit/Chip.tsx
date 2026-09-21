import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Pills are hand-rolled spans throughout this codebase (there is no Badge
 * primitive); this one keeps every surface consistent rather than introducing
 * a second style.
 */
export function Chip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}
