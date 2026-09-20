import { Outlet } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { Navbar } from "@/components/marketing/Navbar"
import { SmoothScroll } from "@/components/marketing/SmoothScroll"

/**
 * The public site's shell: smooth scrolling, the nav bar and the page body.
 *
 * `reducedMotion="user"` covers every reveal on the page at once: a visitor
 * who asked for reduced motion gets the fade and none of the movement, so no
 * section has to remember the preference on its own.
 */
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
