import { Link } from "@tanstack/react-router"
import Logo from "@/components/Layout/Logo"

// Every entry points at a route or anchor that exists today.
const footerColumns = [
  {
    title: "Product",
    links: [
      { href: "#how-it-works", name: "How it works" },
      { href: "#features", name: "Features" },
      { href: "#pricing", name: "Pricing" },
      { href: "#faq", name: "FAQ" },
    ],
  },
] as const

const accountLinks = [
  { to: "/sign-in", name: "Sign in" },
  { to: "/overview", name: "Dashboard" },
] as const

const footerLinkClassName =
  "text-sm text-muted-foreground transition-colors hover:text-foreground"

export function Footer() {
  return (
    <footer className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-14 rounded-t-marketing-section bg-popover p-8 pb-3 text-popover-foreground sm:p-12 sm:pb-4 lg:p-14 lg:pb-4">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(2,1fr)] md:gap-8">
          <div className="flex max-w-sm flex-col gap-5">
            <Link aria-label="OpenSquad home" className="w-fit" to="/">
              <Logo />
            </Link>
            <p className="text-sm leading-relaxed text-muted-foreground">
              A supervised AI sales team for small agencies. Scout, Researcher
              and Outreach find, research and draft; you approve every word.
            </p>
          </div>
          {footerColumns.map((column) => (
            <div className="flex flex-col gap-4" key={column.title}>
              <h4 className="text-sm font-medium">{column.title}</h4>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.name}>
                    <a className={footerLinkClassName} href={link.href}>
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex flex-col gap-4">
            <h4 className="text-sm font-medium">Account</h4>
            <ul className="flex flex-col gap-2">
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

        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} OpenSquad. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
