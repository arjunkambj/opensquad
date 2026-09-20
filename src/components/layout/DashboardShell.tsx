/**
 * Layout — the signed-in shell: sidebar, header, page frame and the
 * boundaries around a page that fails.
 *
 * It owns chrome only. No screen's data lives here; a page container fetches
 * its own and renders inside `children`.
 */
import type { ReactNode } from "react"
import { useCallback, useState } from "react"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { DashboardHeader } from "@/components/layout/DashboardHeader"
import type { ProfileUser } from "@/components/layout/SidebarUser"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * Whether this viewer keeps the sidebar expanded or on the icon rail.
 *
 * Per viewer and per browser, which is what makes `localStorage` the right
 * home for it: it is a preference about this screen, not org state, and
 * nothing server-side should care. Every access is guarded — a private window
 * or blocked site data throws on read, and the shell must still render.
 */
const SIDEBAR_STORAGE_KEY = "sidebar:expanded"

function readStoredSidebarOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    return stored === null ? true : stored === "true"
  } catch {
    return true
  }
}

export function DashboardShell({
  children,
  user,
}: {
  children: ReactNode
  user: ProfileUser
}) {
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
        className="bg-background"
        open={sidebarOpen}
        onOpenChange={changeSidebarOpen}
      >
        <AppSidebar user={user} />
        <SidebarInset className="min-w-0 bg-background">
          <DashboardHeader />
          <div className="flex min-w-0 flex-1 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
