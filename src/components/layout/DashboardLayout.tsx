import { useUser } from "@hexclave/react"
import { CatchBoundary, Outlet, useRouterState } from "@tanstack/react-router"
import { Suspense } from "react"
import { OrgBoundary } from "@/components/auth/OrgBoundary"
import { RouteContentSkeleton } from "@/components/layout/RouteContentSkeleton"
import { DashboardRouteError } from "@/components/layout/DashboardRouteError"
import { DashboardShell } from "@/components/layout/DashboardShell"

/** The shell is static, so it renders immediately; only the page content waits on auth. */
export function DashboardLayout() {
  return (
    <DashboardShell>
      <Suspense fallback={<RouteContentSkeleton />}>
        <AuthedContent />
      </Suspense>
    </DashboardShell>
  )
}

function AuthedContent() {
  const user = useUser({ or: "redirect" })
  // Reset on the full href, including search, so clearing a stale cursor recovers the boundary.
  const href = useRouterState({ select: (state) => state.location.href })

  return (
    <CatchBoundary getResetKey={() => href} errorComponent={DashboardRouteError}>
      {/* Wait for an active organization before mounting tenant queries. */}
      <OrgBoundary user={user} fallback={<RouteContentSkeleton />}>
        <Outlet />
      </OrgBoundary>
    </CatchBoundary>
  )
}
