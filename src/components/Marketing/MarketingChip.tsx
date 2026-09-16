import { ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { LogoMark } from "@/components/Layout/Logo"
import { cn } from "@/lib/utils"

/**
 * Section eyebrow: an icon tile beside a label badge.
 *
 * Each section passes its own icon so the chips read as a set without
 * repeating the product mark. `tone="inverted"` flips the tile for chips
 * that sit on a foreground-colored surface, such as the closing CTA.
 */
export function MarketingChip({
  icon,
  label,
  href,
  tone = "default",
}: {
  /** A section icon, or "logo" to use the OpenSquad mark as the tile. */
  icon: IconSvgElement | "logo"
  label: string
  href?: string
  tone?: "default" | "inverted"
}) {
  const content = (
    <>
      {icon === "logo" ? (
        <LogoMark
          className={cn(
            "size-7",
            tone === "inverted" ? "text-background" : "text-foreground",
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            tone === "inverted"
              ? "bg-background text-foreground"
              : "bg-foreground text-background",
          )}
        >
          <HugeiconsIcon
            className="size-[1.125rem]"
            icon={icon}
            strokeWidth={2}
          />
        </span>
      )}
      <span className="inline-flex h-7 w-fit shrink-0 items-center justify-center gap-1 rounded-lg bg-secondary px-3 py-1 text-xs font-medium whitespace-nowrap text-secondary-foreground">
        {label}
        {href ? (
          <HugeiconsIcon className="size-3" icon={ArrowRight02Icon} />
        ) : null}
      </span>
    </>
  )

  return href ? (
    <Link
      className="inline-flex w-fit items-center gap-1.5 rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      to={href}
    >
      {content}
    </Link>
  ) : (
    <div className="inline-flex w-fit items-center gap-1.5">{content}</div>
  )
}
