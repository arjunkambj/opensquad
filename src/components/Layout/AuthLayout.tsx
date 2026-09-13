import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import Logo from "@/components/Layout/Logo"

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <header className="absolute inset-x-0 top-0 flex h-14 items-center px-4 sm:px-6">
        <Link to="/" className="inline-flex">
          <Logo className="gap-2" />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-20 sm:px-6 sm:py-24">
        {children}
      </main>
    </div>
  )
}
