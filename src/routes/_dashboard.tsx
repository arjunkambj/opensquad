import { useUser } from "@hexclave/react"
import { Outlet, createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"
import { DashboardLoadingSkeleton } from "@/components/Layout/DashboardLoadingSkeleton"
import { DashboardShell } from "@/components/Layout/DashboardShell"

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

  return (
    <DashboardShell
      user={{
        displayName: user.displayName,
        primaryEmail: user.primaryEmail,
        profileImageUrl: user.profileImageUrl,
      }}
    >
      <Outlet />
    </DashboardShell>
  )
}
