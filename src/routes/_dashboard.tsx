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
import { domainErrorCode, errorMessage } from "@/lib/convex-error"

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

  if (code === "NOT_FOUND") {
    return (
      <EmptyState
        title="Not found"
        description={errorMessage(
          error,
          "That record doesn't exist, or it belongs to another workspace.",
        )}
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
