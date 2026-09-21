import { ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"

/**
 * Section eyebrow: an icon tile beside a label badge.
 *
 * Pairs an outline icon, or any custom mark such as the logo, on a pale
 * accent tile with a rounded label. The two pieces touch with no gap.
 */
export function MarketingChip({
  icon,
  label,
  href,
}: {
  icon: IconSvgElement | ReactNode
  label: string
  href?: string
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-section-accent text-section-accent-foreground"
      >
        {isHugeicon(icon) ? (
          <HugeiconsIcon className="size-4" icon={icon} strokeWidth={1.75} />
        ) : (
          icon
        )}
      </span>
      <Badge size="section" variant="surface">
        {label}
        {href ? (
          <HugeiconsIcon data-icon="inline-end" icon={ArrowRight02Icon} />
        ) : null}
      </Badge>
    </>
  )

  return href ? (
    <Link
      className="inline-flex w-fit items-center gap-0 rounded-xl outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      to={href}
    >
      {content}
    </Link>
  ) : (
    <div className="inline-flex w-fit items-center gap-0">{content}</div>
  )
}

/** Hugeicons ship as arrays of SVG node tuples; anything else is a rendered node. */
function isHugeicon(icon: IconSvgElement | ReactNode): icon is IconSvgElement {
  return Array.isArray(icon) && Array.isArray(icon[0])
}
