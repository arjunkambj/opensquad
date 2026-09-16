import Lenis from "lenis"
import { useEffect, type ReactNode } from "react"

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
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
