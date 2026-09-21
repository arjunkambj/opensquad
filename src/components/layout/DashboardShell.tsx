import type { ReactNode } from "react"
import { useCallback, useState } from "react"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { DashboardHeader } from "@/components/layout/DashboardHeader"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Sidebar state is a browser preference. Storage can throw in private or restricted contexts. */
const SIDEBAR_STORAGE_KEY = "sidebar:expanded"

function readStoredSidebarOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    return stored === null ? true : stored === "true"
  } catch {
    return true
  }
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(readStoredSidebarOpen)

  const changeSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpen(open)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open))
    } catch {
      // A viewer with site data blocked keeps the choice for this session
      // only. Losing it is not worth a broken shell.
    }
  }, [])

  return (
    <TooltipProvider>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={changeSidebarOpen}
      >
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <div className="flex min-w-0 flex-1 flex-col bg-panel md:rounded-2xl md:ring-1 md:ring-sidebar-border/60">
            <DashboardHeader />
            <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
