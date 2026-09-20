/**
 * InfoBanner — the tinted explanatory strip above the ICP review list
 * (ref 11), and the quieter ⓘ line under a form group (refs 08, 09, 11).
 *
 * `title` is the sentence that carries the point and `children` the muted
 * qualifier, which is the shape every one of those banners has. The `plain`
 * tone drops the tint for the inline note; nothing here is dismissible,
 * because a banner the user must act on belongs in the flow, not in a strip.
 */
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type InfoBannerProps = {
  icon?: IconSvgElement
  /** The lead sentence, set in the foreground weight. */
  title?: ReactNode
  /** The muted remainder. */
  children?: ReactNode
  /** Tinted panel (ref 11) or a bare inline note (refs 08, 09). */
  tone?: "primary" | "plain"
  className?: string
}

export function InfoBanner({
  icon,
  title,
  children,
  tone = "primary",
  className,
}: InfoBannerProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-sm",
        tone === "primary"
          ? "rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3"
          : "text-xs",
        className,
      )}
    >
      {icon ? (
        <HugeiconsIcon
          icon={icon}
          strokeWidth={2}
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground",
            tone === "primary" ? "size-4" : "size-3.5",
          )}
          aria-hidden="true"
        />
      ) : null}
      <p className="min-w-0 text-muted-foreground">
        {title ? (
          <span className="font-medium text-foreground">{title} </span>
        ) : null}
        {children}
      </p>
    </div>
  )
}
