import Logo from "@/components/layout/Logo"
import { SidebarTrigger } from "@/components/ui/sidebar"

/**
 * The phone-width header, and only that.
 *
 * On desktop the reference has no top bar: navigation, credits and the
 * account all live in the sidebar, and a second empty strip above the
 * page would just steal 56px from every screen. Below `md` the sidebar is a
 * sheet, so something has to open it — that is this row's whole job.
 */
export function DashboardHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 md:hidden">
      <SidebarTrigger />
      <Logo markClassName="size-7" />
    </header>
  )
}
