import { useUser } from "@hexclave/react"
import { CatchBoundary, Outlet, useRouterState } from "@tanstack/react-router"
import { Suspense } from "react"
import { DashboardLoadingSkeleton } from "@/components/layout/DashboardLoadingSkeleton"
import { DashboardRouteError } from "@/components/layout/DashboardRouteError"
import { DashboardShell } from "@/components/layout/DashboardShell"

/** The signed-in shell: suspend until the session resolves, then render it. */
export function DashboardLayout() {
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
