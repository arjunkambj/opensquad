import { useEffect, useMemo, useState } from "react"

export const revealContainerVariants = {
  animate: {
    transition: { staggerChildren: 0.1 },
  },
  initial: {},
}

export const revealItemVariants = {
  animate: {
    opacity: 1,
    transition: { duration: 0.6, ease: "easeInOut" as const },
    y: 0,
  },
  initial: { opacity: 0, y: 30 },
}

export const revealCardVariants = {
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: "easeInOut" as const },
    y: 0,
  },
  initial: { opacity: 0, scale: 0.95, y: 30 },
}

export function useRevealViewport() {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 639px)").matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)")
    const updateViewport = () => setIsMobile(mediaQuery.matches)

    mediaQuery.addEventListener("change", updateViewport)
    return () => mediaQuery.removeEventListener("change", updateViewport)
  }, [])

  return useMemo(
    () => ({ amount: isMobile ? 0.15 : 0.3, once: true }) as const,
    [isMobile],
  )
}

export type RevealViewport = ReturnType<typeof useRevealViewport>
