import { useUser } from "@hexclave/react"
import { CatchBoundary, Outlet, useRouterState } from "@tanstack/react-router"
import { Suspense } from "react"
import { OrgBoundary } from "@/components/auth/OrgBoundary"
import { DashboardLoadingSkeleton } from "@/components/layout/DashboardLoadingSkeleton"
import { DashboardRouteError } from "@/components/layout/DashboardRouteError"
import { DashboardShell } from "@/components/layout/DashboardShell"

export function DashboardLayout() {
  return (
    <Suspense fallback={<DashboardLoadingSkeleton />}>
      <AuthedDashboard />
    </Suspense>
  )
}

function AuthedDashboard() {
  const user = useUser({ or: "redirect" })
  // Reset on the full href, including search, so clearing a stale cursor recovers the boundary.
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
        {/* Wait for an active organization before mounting tenant queries. */}
        <OrgBoundary user={user} fallback={<DashboardLoadingSkeleton />}>
          <Outlet />
        </OrgBoundary>
      </CatchBoundary>
    </DashboardShell>
  )
}
