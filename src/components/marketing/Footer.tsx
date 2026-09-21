import { Mail01Icon, NewTwitterIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import Logo from "@/components/layout/Logo"

const SUPPORT_EMAIL = "support@openintent.ai"

const productLinks = [
  { href: "/#how-it-works", name: "How it works" },
  { href: "/#features", name: "Features" },
  { href: "/#trial", name: "Trial" },
  { href: "/#faq", name: "FAQ" },
] as const

const accountLinks = [
  { to: "/sign-in", name: "Sign in" },
  { to: "/dashboard", name: "Dashboard" },
] as const

const socialButtonClassName =
  "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
    } catch {
      // The title attribute still carries the address.
    }
  }

  return (
    <button
      aria-label={copied ? "Email copied" : `Copy email ${email}`}
      className={socialButtonClassName}
      onClick={copyEmail}
      title={copied ? "Copied" : email}
      type="button"
    >
      <HugeiconsIcon
        aria-hidden="true"
        className="size-4"
        icon={copied ? Tick02Icon : Mail01Icon}
      />
    </button>
  )
}

export function Footer() {
  return (
    <footer className="relative isolate mt-24 w-full overflow-hidden bg-card text-card-foreground sm:mt-32">
      <div className="@container mx-auto flex w-full max-w-7xl flex-col px-4 pt-12 pb-6 sm:px-6 sm:pt-14 lg:px-8 lg:pb-8">
        <p
          aria-hidden="true"
          className="footer-wordmark pointer-events-none absolute inset-x-0 -bottom-[0.22em] -z-10 leading-none font-bold font-display tracking-tighter text-center text-foreground/[0.04] select-none"
        >
          OpenIntent
        </p>
        <Link aria-label="OpenIntent home" className="w-fit" to="/">
          <Logo />
        </Link>
        <div className="mt-12 flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="flex max-w-xs flex-col">
            <p className="text-sm leading-relaxed text-muted-foreground">
              An AI sales agent that finds your leads and emails them from
              your own inbox.
            </p>
            <div className="-ml-2 mt-4 flex items-center">
              <a
                aria-label="OpenIntent on X"
                className={socialButtonClassName}
                href="https://x.com/arjunkambj"
                rel="noreferrer"
                target="_blank"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-4"
                  icon={NewTwitterIcon}
                />
              </a>
              <CopyEmailButton email={SUPPORT_EMAIL} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-10 lg:gap-x-16">
            <div className="flex flex-col">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden="true"
                  className="size-1.5 bg-illustration-accent"
                />
                Product
              </h4>
              <ul className="mt-2.5 flex flex-col gap-2 pl-3.5">
                {productLinks.map((link) => (
                  <li key={link.name}>
                    <a
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      href={link.href}
                    >
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden="true"
                  className="size-1.5 bg-illustration-accent"
                />
                Account
              </h4>
              <ul className="mt-2.5 flex flex-col gap-2 pl-3.5">
                {accountLinks.map((link) => (
                  <li key={link.name}>
                    <Link
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      to={link.to}
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-28 flex flex-col gap-3 text-sm text-muted-foreground sm:mt-40 sm:flex-row sm:items-center sm:justify-between lg:mt-48">
          <p>&copy; {new Date().getFullYear()} OpenIntent. All rights reserved.</p>
          <a
            className="w-fit transition-colors hover:text-foreground"
            href="/#hero"
          >
            Back to top ↑
          </a>
        </div>
      </div>
    </footer>
  )
}
