import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import Logo from "@/components/layout/Logo"

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background p-4 sm:p-6 lg:p-8">
      <div className="grid flex-1 gap-8 lg:grid-cols-2 lg:gap-12">
        <AuthPanel />

        <div className="flex flex-col">
          <div className="lg:hidden">
            <HomeLink />
          </div>

          <main className="flex flex-1 items-center justify-center py-8 sm:py-10">
            {children}
          </main>

          <footer className="text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} OpenIntent. All rights reserved.
          </footer>
        </div>
      </div>
    </div>
  )
}

function AuthPanel() {
  return (
    <aside className="relative hidden overflow-hidden rounded-2xl lg:flex lg:flex-col lg:justify-between lg:p-10">
      <img
        alt=""
        className="absolute inset-0 size-full object-cover object-right-bottom"
        loading="eager"
        src="/marketing/hero-landscape.png"
      />
      <div
        aria-hidden="true"
        className="absolute inset-3 rounded-xl border border-background/40"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-background/80 to-transparent"
      />

      <div className="relative">
        <HomeLink />
      </div>

      <div className="relative flex max-w-md flex-col gap-3">
        <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
          Your AI sales agent
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Finds leads, does the research, sends the emails from your inbox.
          You get a heads-up when something needs your OK.
        </p>
      </div>
    </aside>
  )
}

function HomeLink() {
  return (
    <Link to="/" className="inline-flex">
      <Logo />
    </Link>
  )
}
