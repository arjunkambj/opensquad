import { Alert02Icon, InformationCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export function LoadingState({
  title = "Loading",
  description,
  className,
}: {
  title?: string
  description?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <Spinner className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

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
        "flex flex-col items-center justify-center text-center",
        plain
          ? "gap-3 px-6 py-14"
          : "gap-2 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-6 py-12",
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
    <Card className={cn("border-destructive/40", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-4"
            aria-hidden="true"
          />
          {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {onRetry ? (
        <CardContent>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </CardContent>
      ) : null}
    </Card>
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
