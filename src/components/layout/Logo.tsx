import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * The OpenIntent mark: a solid rounded tile with a rising three-step signal
 * cut out of it — find, research, contact. The steps are masked, not drawn,
 * so the mark reads on light and dark surfaces with a single `currentColor`.
 *
 * Ours, not the reference's: the reference's own mark and wordmark are their
 * brand and are never reused (PLAN §2).
 *
 * The mask id is per-instance: several marks render on one page (sidebar,
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
  const maskId = `openintent-mark-mask-${useId().replace(/:/g, "")}`
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("size-8 shrink-0 text-primary", className)}
      role={title ? "img" : undefined}
      viewBox="0 0 32 32"
    >
      <defs>
        <mask id={maskId}>
          <rect fill="white" height="32" rx="10" width="32" />
          <rect fill="black" height="6" rx="2" width="4.5" x="7" y="18" />
          <rect fill="black" height="11" rx="2" width="4.5" x="13.75" y="13" />
          <rect fill="black" height="16" rx="2" width="4.5" x="20.5" y="8" />
        </mask>
      </defs>
      <rect
        fill="currentColor"
        height="32"
        mask={`url(#${maskId})`}
        rx="10"
        width="32"
      />
    </svg>
  )
}

export default function Logo({
  className,
  markOnly = false,
  markClassName,
  labelClassName,
}: {
  className?: string
  markOnly?: boolean
  markClassName?: string
  /** For the collapsed rail, which hides the word and keeps the mark. */
  labelClassName?: string
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 text-foreground",
        className,
      )}
    >
      <LogoMark
        className={markClassName}
        title={markOnly ? "OpenIntent" : undefined}
      />
      {!markOnly && (
        <span
          className={cn(
            "font-display text-[1.15rem] leading-none font-semibold tracking-[-0.03em]",
            labelClassName,
          )}
        >
          OpenIntent
        </span>
      )}
    </div>
  )
}
