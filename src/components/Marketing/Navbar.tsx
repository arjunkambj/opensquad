import { useUser } from "@hexclave/react"
import { Menu02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { Suspense, useState } from "react"
import Logo from "@/components/Layout/Logo"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const navVariants = {
  animate: {
    opacity: 1,
    transition: { duration: 0.5, ease: "easeInOut" as const },
    y: 0,
  },
  initial: { opacity: 0, y: -20 },
}

export const marketingNavLinks = [
  { href: "#features", name: "Features" },
  { href: "#pricing", name: "Pricing" },
  { href: "#faq", name: "FAQ" },
] as const

const navLinkClassName =
  "rounded-md px-2 py-2 text-sm font-medium text-background/90 transition-colors hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background"

const sheetLinkClassName =
  "flex min-h-11 items-center rounded-xl px-3 text-base font-medium text-foreground transition-colors hover:bg-muted"

/** Signed-out actions; also the Suspense fallback while the session resolves. */
function SignedOutActions() {
  return (
    <>
      <Link
        className={`hidden sm:inline-flex ${navLinkClassName}`}
        to="/sign-in"
      >
        Sign in
      </Link>
      <Button
        nativeButton={false}
        render={<Link to="/sign-in" />}
        size="nav"
        variant="outline"
      >
        Get started
      </Button>
    </>
  )
}

function AccountActions() {
  const user = useUser()

  if (user) {
    return (
      <Button
        nativeButton={false}
        render={<Link to="/overview" />}
        size="nav"
        variant="outline"
      >
        Dashboard
      </Button>
    )
  }

  return <SignedOutActions />
}

function SheetAccountLink({ onNavigate }: { onNavigate: () => void }) {
  const user = useUser()

  return user ? (
    <Link className={sheetLinkClassName} onClick={onNavigate} to="/overview">
      Dashboard
    </Link>
  ) : (
    <Link className={sheetLinkClassName} onClick={onNavigate} to="/sign-in">
      Sign in
    </Link>
  )
}

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <motion.div
      className="sticky top-4 z-50 mt-4 w-full md:top-6 md:mt-6"
      initial="initial"
      variants={navVariants}
      viewport={{ once: true }}
      whileInView="animate"
    >
      <div className="mx-auto flex w-full max-w-7xl justify-center px-4 sm:px-6 lg:px-8">
        <nav
          aria-label="Main navigation"
          className="marketing-ink flex w-full items-center justify-between gap-4 rounded-xl p-1.5 sm:w-fit sm:gap-5"
        >
          <Link
            aria-label="OpenSquad home"
            className="flex shrink-0 items-center rounded-lg text-background focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-background"
            to="/"
          >
            <Logo
              className="text-background hover:text-background/80"
              markClassName="size-8"
              markOnly
            />
          </Link>

          <ul className="hidden items-center gap-4 sm:flex">
            {marketingNavLinks.map((link) => (
              <li key={link.name}>
                <a className={navLinkClassName} href={link.href}>
                  {link.name}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Sheet onOpenChange={setMenuOpen} open={menuOpen}>
              <SheetTrigger
                render={
                  <button
                    aria-label="Open navigation menu"
                    className="flex size-8 items-center justify-center rounded-lg text-background transition-colors hover:bg-background/10 focus-visible:outline-2 focus-visible:outline-background sm:hidden"
                    type="button"
                  />
                }
              >
                <HugeiconsIcon icon={Menu02Icon} size={20} strokeWidth={2} />
              </SheetTrigger>
              <SheetContent className="w-[min(20rem,88vw)]" side="right">
                <SheetHeader className="border-b">
                  <SheetTitle>
                    <Logo />
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    Site navigation
                  </SheetDescription>
                </SheetHeader>

                <nav className="flex flex-col gap-1 px-3 py-4">
                  {marketingNavLinks.map((link) => (
                    <a
                      className={sheetLinkClassName}
                      href={link.href}
                      key={link.name}
                      onClick={closeMenu}
                    >
                      {link.name}
                    </a>
                  ))}
                  <Suspense
                    fallback={
                      <Link
                        className={sheetLinkClassName}
                        onClick={closeMenu}
                        to="/sign-in"
                      >
                        Sign in
                      </Link>
                    }
                  >
                    <SheetAccountLink onNavigate={closeMenu} />
                  </Suspense>
                </nav>
              </SheetContent>
            </Sheet>
            <Suspense fallback={<SignedOutActions />}>
              <AccountActions />
            </Suspense>
          </div>
        </nav>
      </div>
    </motion.div>
  )
}
