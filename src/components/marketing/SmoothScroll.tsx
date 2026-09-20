import Lenis from "lenis"
import { useEffect, type ReactNode } from "react"

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    // A user who asked for reduced motion did not ask for smoothed scrolling —
    // wheel/touch hijack is exactly the kind of non-essential motion the
    // preference exists to remove. Native scrolling handles anchors fine.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }
    const lenis = new Lenis({
      lerp: 0.12,
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      autoRaf: true,
      anchors: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.25,
    })

    return () => {
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
