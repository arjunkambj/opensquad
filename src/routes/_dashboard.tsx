import { useUser } from "@hexclave/react"
import {
  CatchBoundary,
  Link,
  Outlet,
  createFileRoute,
  useRouterState,
} from "@tanstack/react-router"
import type { ErrorComponentProps } from "@tanstack/react-router"
import { Suspense } from "react"
import { DashboardLoadingSkeleton } from "@/components/Layout/DashboardLoadingSkeleton"
import { DashboardShell } from "@/components/Layout/DashboardShell"
import { EmptyState, ErrorState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import {
  domainErrorCode,
  errorMessage,
  isMalformedIdError,
} from "@/lib/convex-error"

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <Suspense fallback={<DashboardLoadingSkeleton />}>
      <AuthedDashboard />
    </Suspense>
  )
}

function AuthedDashboard() {
  const user = useUser({ or: "redirect" })
  // Reset the boundary on any location change, SEARCH INCLUDED — not just the
  // pathname. Several failures here are caused by a search param rather than a
  // route: a stale pagination cursor throws, and `reset` alone would re-render
  // the same bad cursor forever. Keying on the full href means clearing the
  // offending param is a real recovery.
  const href = useRouterState({ select: (state) => state.location.href })

  return (
    <DashboardShell
      user={{
        displayName: user.displayName,
        primaryEmail: user.primaryEmail,
        profileImageUrl: user.profileImageUrl,
      }}
    >
      <CatchBoundary
        getResetKey={() => href}
        errorComponent={DashboardRouteError}
      >
        <Outlet />
      </CatchBoundary>
    </DashboardShell>
  )
}

/**
 * Page-level failure, rendered INSIDE the shell so the sidebar survives it.
 *
 * A boundary on the route itself would replace `AuthedDashboard`, which is the
 * shell — the user would lose every way out of the page that just failed. The
 * backend's `domainError` codes distinguish the cases that have different
 * recoveries; anything else is genuinely unexpected and only offers a retry.
 */
function DashboardRouteError({ error, reset }: ErrorComponentProps) {
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
            ? "Your role in this workspace doesn't allow this page. An owner can change it in Settings."
            : "Sign in again to continue."
        }
        action={<Button render={<Link to="/overview" />}>Go to Overview</Button>}
      />
    )
  }

  // A malformed id in the URL means the same thing to the reader as a foreign
  // one — that record is not here — but it fails Convex ARGUMENT validation
  // before the handler runs, so it carries no domain code and would otherwise
  // render as a raw `ArgumentValidationError` with a request id. V09 step 3
  // opens exactly this URL.
  if (code === "NOT_FOUND" || isMalformedIdError(error)) {
    return (
      <EmptyState
        title="Not found"
        description={
          code === "NOT_FOUND"
            ? errorMessage(
                error,
                "That record doesn't exist, or it belongs to another workspace.",
              )
            : "That link doesn't name a record in this workspace. It may have been edited, truncated or copied from somewhere else."
        }
        action={<Button render={<Link to="/overview" />}>Go to Overview</Button>}
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
