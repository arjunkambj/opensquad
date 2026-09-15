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
import type { WorkspaceRole } from "@/lib/workspace-role"

/**
 * Shared empty/loading/error states (V11). Page-level components should use
 * these instead of ad-hoc "…" placeholders so a loading view can never be
 * mistaken for completed-but-empty work.
 */

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

export function EmptyState({
  icon = InformationCircleIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconSvgElement
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[min(var(--radius-4xl),24px)] border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className="size-5 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
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

/**
 * Permission-denied, which is NOT empty and must not look like it.
 *
 * Empty says *nothing is here yet, and here is what will fill it*.
 * Permission-denied says *this exists, you cannot change it, and here is who
 * can*. It replaces the action group rather than sitting beneath a row of
 * disabled buttons — a disabled control whose reason is three paragraphs away
 * is the defect this exists to remove.
 *
 * Pass `id` and point the control's `aria-describedby` at it where a control
 * genuinely has to stay rendered and disabled; `role="status"` then makes the
 * reason reachable to a screen-reader user rather than only to a sighted one.
 */
export function PermissionNote({
  role,
  action,
  id,
  className,
}: {
  role: WorkspaceRole
  action: string
  id?: string
  className?: string
}) {
  return (
    <p
      id={id}
      role="status"
      className={cn("text-sm text-muted-foreground", className)}
    >
      {role === "viewer"
        ? `You have read-only access to this workspace. An owner or operator can ${action}.`
        : `Your ${role} role cannot ${action}. An owner can.`}
    </p>
  )
}

/** Inline mutation error line used below forms. */
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
