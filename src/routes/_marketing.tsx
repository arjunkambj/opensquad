import { Outlet, createFileRoute } from "@tanstack/react-router"
import { Navbar } from "@/components/Marketing/Navbar"
import { SmoothScroll } from "@/components/Marketing/SmoothScroll"

export const Route = createFileRoute("/_marketing")({
  component: MarketingLayout,
})

function MarketingLayout() {
  return (
    <SmoothScroll>
      <div className="marketing-page flex min-h-dvh w-full scroll-pt-24 flex-col overflow-x-clip bg-background">
        <Navbar />
        <Outlet />
      </div>
    </SmoothScroll>
  )
}
