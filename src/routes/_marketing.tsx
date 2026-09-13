import { Outlet, createFileRoute } from "@tanstack/react-router"
import { Navbar } from "@/components/Marketing/Navbar"

export const Route = createFileRoute("/_marketing")({
  component: MarketingLayout,
})

function MarketingLayout() {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      <Navbar />
      <Outlet />
    </div>
  )
}
