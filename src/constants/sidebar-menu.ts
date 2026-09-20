import {
  Briefcase01Icon,
  Home01Icon,
  InboxIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

export type MenuHref = "/inbox" | "/leads" | "/overview" | "/settings"

export type MenuItem = {
  name: string
  href: MenuHref
  icon: IconSvgElement
}

export type MenuCategory = {
  name: string
  items: MenuItem[]
}

// The work band, in §3 order: Leads, Inbox, Overview. Each item lands in the
// same change as its route — never before, or the nav promises a page that
// 404s. `/leads` is the CRM home; `/prospects` is a redirect, not a second
// entry.
//
// Inbox's count badge is not declared here, and deliberately so: it comes from
// `useInboxAttention` — the same hook and arguments the attention surface uses,
// one call. Two sources for one count is a defect.
export const sidebarMainItems: MenuItem[] = [
  {
    name: "Leads",
    href: "/leads",
    icon: Briefcase01Icon,
  },
  {
    name: "Inbox",
    href: "/inbox",
    icon: InboxIcon,
  },
  {
    name: "Overview",
    href: "/overview",
    icon: Home01Icon,
  },
]

export const sidebarCategories: MenuCategory[] = []

export const sidebarFooterItems: MenuItem[] = [
  {
    name: "Settings",
    href: "/settings",
    icon: Settings02Icon,
  },
]
