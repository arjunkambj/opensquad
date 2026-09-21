import { Alert02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// EmptyState and ErrorState share one surface so a page reads the same whichever it lands on.
const standaloneStateClassName =
  "flex flex-col items-center justify-center gap-2 rounded-card bg-card px-6 py-12 text-center"

export type EmptyStateProps = {
  icon?: IconSvgElement
  /** A richer illustration, rendered instead of `icon` when given. */
  illustration?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  /** Use outlined for page-level states and plain inside cards that already have a border. */
  variant?: "outlined" | "plain"
  className?: string
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  variant = "outlined",
  className,
}: EmptyStateProps) {
  const plain = variant === "plain"
  // Outlined stands on its own, so it always shows a mark; plain sits inside
  // something that already frames it and shows one only when asked.
  const mark = icon ?? (plain ? undefined : InformationCircleIcon)

  return (
    <div
      className={cn(
        plain
          ? "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
          : standaloneStateClassName,
        className,
      )}
    >
      {illustration ??
        (mark === undefined ? null : (
          <HugeiconsIcon
            icon={mark}
            strokeWidth={plain ? 1.5 : 2}
            className={cn(
              "text-muted-foreground",
              plain ? "size-9" : "size-5",
            )}
            aria-hidden="true"
          />
        ))}
      <p
        className={
          plain
            ? "font-heading text-base font-semibold text-foreground"
            : "text-sm font-medium text-foreground"
        }
      >
        {title}
      </p>
      {description ? (
        <div
          className={cn(
            "max-w-md text-sm text-muted-foreground",
            plain ? "leading-relaxed" : "",
          )}
        >
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}) {
  return (
    <div role="alert" className={cn(standaloneStateClassName, className)}>
      <HugeiconsIcon
        icon={Alert02Icon}
        strokeWidth={2}
        className="size-5 text-destructive"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" className="mt-2" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (message === null) {
    return null
  }
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}
