import {
  DashboardSquare01Icon,
  InboxIcon,
  Robot01Icon,
  Settings02Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

export type MenuHref =
  | "/dashboard"
  | "/agent"
  | "/contacts"
  | "/inbox"
  | "/settings"

export type MenuItem = {
  name: string
  href: MenuHref
  icon: IconSvgElement
}

/**
 * The whole navigation, in PLAN §5 order: Dashboard, Agent, Contacts, Inbox,
 * Settings. Five pages, all of which work — the reference's Copilot, Search,
 * Insights, Help, Roadmap and Referral entries are cut (PLAN §2), and a cut
 * item is left out rather than rendered as dead chrome.
 *
 * Each item lands in the same change as its route; never before, or the nav
 * promises a page that 404s.
 *
 * Inbox's count badge is not declared here, and deliberately so: it comes
 * from `useInboxAttention` — the same hook and arguments the inbox surfaces
 * use, one call. Two sources for one count is a defect.
 */
export const sidebarMainItems: MenuItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: DashboardSquare01Icon,
  },
  {
    name: "Agent",
    href: "/agent",
    icon: Robot01Icon,
  },
  {
    name: "Contacts",
    href: "/contacts",
    icon: UserMultipleIcon,
  },
  {
    name: "Inbox",
    href: "/inbox",
    icon: InboxIcon,
  },
  {
    name: "Settings",
    href: "/settings",
    icon: Settings02Icon,
  },
]
