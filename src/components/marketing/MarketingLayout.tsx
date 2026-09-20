import { Outlet } from "@tanstack/react-router"
import { Navbar } from "@/components/marketing/Navbar"
import { SmoothScroll } from "@/components/marketing/SmoothScroll"

/** The public site's shell: smooth scrolling, the nav bar and the page body. */
export function MarketingLayout() {
  return (
    <SmoothScroll>
      <div className="marketing-page flex min-h-dvh w-full scroll-pt-24 flex-col overflow-x-clip bg-background">
        <Navbar />
        <Outlet />
      </div>
    </SmoothScroll>
  )
}
