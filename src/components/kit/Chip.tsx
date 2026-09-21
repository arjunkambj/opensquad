import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Pills are hand-rolled spans throughout this codebase (there is no Badge
 * primitive); this one keeps every surface consistent rather than introducing
 * a second style.
 *
 * `muted` is for plain facts. Reach for `accent` when the chip asks for a
 * look (a draft waiting, interest, "you"), `success` for something that went
 * through, and `destructive` for something that failed.
 */
const chipVariants = cva(
  "inline-flex items-center rounded-lg px-2.5 py-1 text-xs",
  {
    variants: {
      variant: {
        muted: "bg-muted text-muted-foreground",
        accent: "bg-section-accent font-medium text-section-accent-foreground",
        success: "bg-chart-2/15 text-chart-2",
        destructive: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
)

export type ChipVariant = NonNullable<VariantProps<typeof chipVariants>["variant"]>

export function Chip({
  children,
  variant,
  className,
}: {
  children: ReactNode
  variant?: ChipVariant
  className?: string
}) {
  return <span className={cn(chipVariants({ variant }), className)}>{children}</span>
}
