import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import Logo from "@/components/Layout/Logo"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(
    () => typeof window !== "undefined" && window.scrollY > 24,
  )

  useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 24
      setIsScrolled((prev) => (prev === next ? prev : next))
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky z-50 mx-auto rounded-2xl backdrop-blur-lg transition-[width,background-color,transform] duration-300",
        isScrolled
          ? "top-1.5 mt-1.5 w-[min(42rem,calc(100%-0.75rem))] translate-y-1 bg-card/95 sm:top-2 sm:mt-2 sm:w-[min(42rem,calc(100%-2rem))]"
          : "top-1.5 mt-1.5 w-[min(80rem,calc(100%-0.75rem))] bg-background/95 sm:top-3 sm:mt-3 sm:w-[min(80rem,calc(100%-2rem))]",
      )}
    >
      <nav className="flex h-11 w-full items-center justify-between gap-4 px-2.5 sm:h-14 sm:gap-6 sm:px-6">
        <Link aria-label="OpenSquad" className="justify-self-start" to="/">
          <Logo markOnly markClassName="size-7 sm:size-8" />
        </Link>

        <Button nativeButton={false} render={<Link to="/sign-in" />}>
          Get started
        </Button>
      </nav>
    </header>
  )
}
