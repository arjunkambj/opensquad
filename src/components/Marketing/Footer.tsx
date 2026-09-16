import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import Logo from "@/components/Layout/Logo"
import { Button } from "@/components/ui/button"

// Every entry points at a route or anchor that exists today.
const productLinks = [
  { href: "#squad", name: "What it does" },
  { href: "#how-it-works", name: "How it works" },
  { href: "#features", name: "Features" },
  { href: "#pricing", name: "Pricing" },
  { href: "#faq", name: "FAQ" },
] as const

const accountLinks = [
  { to: "/sign-in", name: "Sign in" },
  { to: "/overview", name: "Dashboard" },
] as const

const footerLinkClassName =
  "text-sm text-background/70 transition-colors hover:text-background"

/** Full-width dark band, matching the navbar, that closes the page. */
export function Footer() {
  return (
    <footer className="marketing-ink-deep mt-24 w-full sm:mt-32">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-4 pt-16 pb-8 sm:px-6 sm:pt-20 lg:px-8">
        <div className="grid gap-12 md:grid-cols-[1.6fr_1fr_1fr] md:gap-8">
          <div className="flex max-w-sm flex-col items-start gap-6">
            <Link aria-label="OpenSquad home" className="w-fit" to="/">
              <Logo className="text-background hover:text-background/80" />
            </Link>
            <p className="text-sm leading-relaxed text-background/70">
              An AI sales squad for small agencies. Scout finds the leads,
              Researcher reads up on them, Outreach sends the emails.
            </p>
            <Button
              nativeButton={false}
              render={<Link to="/sign-in" />}
              size="cta"
              variant="secondary"
            >
              Get started
              <HugeiconsIcon
                aria-hidden="true"
                data-icon="inline-end"
                icon={ArrowUpRight01Icon}
              />
            </Button>
          </div>
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-semibold tracking-eyebrow text-background/50 uppercase">
              Product
            </h4>
            <ul className="flex flex-col gap-2.5">
              {productLinks.map((link) => (
                <li key={link.name}>
                  <a className={footerLinkClassName} href={link.href}>
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4">
            <h4 className="text-xs font-semibold tracking-eyebrow text-background/50 uppercase">
              Account
            </h4>
            <ul className="flex flex-col gap-2.5">
              {accountLinks.map((link) => (
                <li key={link.name}>
                  <Link className={footerLinkClassName} to={link.to}>
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-background/10 pt-6 text-xs text-background/50 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} OpenSquad. All rights reserved.</p>
          <p>Runs on your own Codex or Claude plan.</p>
        </div>
      </div>
    </footer>
  )
}
