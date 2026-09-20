import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * The OpenSquad mark: a solid rounded tile with three dots cut out of it,
 * one per pipeline stage. The dots are masked, not drawn, so the mark reads on
 * light and dark surfaces with a single `currentColor`.
 *
 * The mask id is per-instance: several marks render on one page (navbar,
 * sheet, footer, previews), and a shared literal id left the document holding
 * duplicate ids — invalid HTML, and every `url(#…)` resolving to whichever
 * mask mounted first.
 */
export function LogoMark({
  className,
  title,
}: {
  className?: string
  title?: string
}) {
  const maskId = `opensquad-mark-mask-${useId().replace(/:/g, "")}`
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("size-8 shrink-0", className)}
      role={title ? "img" : undefined}
      viewBox="0 0 32 32"
    >
      <defs>
        <mask id={maskId}>
          <rect fill="white" height="32" rx="9" width="32" />
          <circle cx="11" cy="12.5" fill="black" r="3.6" />
          <circle cx="21" cy="12.5" fill="black" r="3.6" />
          <circle cx="16" cy="21" fill="black" r="3.6" />
        </mask>
      </defs>
      <rect
        fill="currentColor"
        height="32"
        mask={`url(#${maskId})`}
        rx="9"
        width="32"
      />
    </svg>
  )
}

export default function Logo({
  className,
  markOnly = false,
  markClassName,
}: {
  className?: string
  markOnly?: boolean
  markClassName?: string
}) {
  return (
    <div
      className={cn(
        "group flex cursor-pointer items-center gap-2.5 text-foreground transition-colors hover:text-primary",
        className,
      )}
    >
      <LogoMark
        className={markClassName}
        title={markOnly ? "OpenSquad" : undefined}
      />
      {!markOnly && (
        <span className="font-display text-[1.15rem] font-semibold leading-none tracking-[-0.03em]">
          OpenSquad
        </span>
      )}
    </div>
  )
}
