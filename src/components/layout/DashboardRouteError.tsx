import { Link } from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { EmptyState, ErrorState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  domainErrorCode,
  errorMessage,
  isMalformedIdError,
} from "@/lib/convex-error"

/** Render failures inside the shell so the sidebar remains available. */
export function DashboardRouteError({ error, reset }: ErrorComponentProps) {
  const code = domainErrorCode(error)

  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") {
    return (
      <EmptyState
        title={
          code === "FORBIDDEN"
            ? "You don't have access to this"
            : "Your session needs a refresh"
        }
        description={
          code === "FORBIDDEN"
            ? "This account can't open that page in this organization."
            : "Sign in again to continue."
        }
        action={
          <Button render={<Link to="/dashboard" />}>Back to the dashboard</Button>
        }
      />
    )
  }

  // Malformed IDs fail argument validation before the handler; show the same missing-record state as foreign IDs.
  if (code === "NOT_FOUND" || isMalformedIdError(error)) {
    return (
      <EmptyState
        title="Not found"
        description={
          code === "NOT_FOUND"
            ? errorMessage(
                error,
                "That record doesn't exist, or it belongs to another organization.",
              )
            : "That link doesn't name a record in this organization. It may have been edited, truncated or copied from somewhere else."
        }
        action={
          <Button render={<Link to="/dashboard" />}>Back to the dashboard</Button>
        }
      />
    )
  }

  return (
    <ErrorState
      title="This page didn't load"
      description={errorMessage(error, "An unexpected error occurred.")}
      onRetry={reset}
    />
  )
}
