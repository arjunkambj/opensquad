import { Outlet } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { Navbar } from "@/components/marketing/Navbar"
import { SmoothScroll } from "@/components/marketing/SmoothScroll"

export function MarketingLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <SmoothScroll>
        <div className="marketing-page flex min-h-dvh w-full scroll-pt-24 flex-col overflow-x-clip bg-background">
          <Navbar />
          <Outlet />
        </div>
      </SmoothScroll>
    </MotionConfig>
  )
}
