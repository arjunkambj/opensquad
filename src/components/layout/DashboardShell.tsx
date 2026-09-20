/**
 * Layout — the signed-in shell: sidebar, header, page frame and the
 * boundaries around a page that fails.
 *
 * It owns chrome only. No screen's data lives here; a page container fetches
 * its own and renders inside `children`.
 */
import type { ReactNode } from "react"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { DashboardHeader } from "@/components/layout/DashboardHeader"
import type { ProfileUser } from "@/components/layout/UserProfileMenu"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

export function DashboardShell({
  children,
  user,
}: {
  children: ReactNode
  user: ProfileUser
}) {
  return (
    <TooltipProvider>
      <SidebarProvider className="bg-background">
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <DashboardHeader user={user} />
          <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-3 sm:px-6 sm:py-3">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
