import {
  Briefcase01Icon,
  Home01Icon,
  InboxIcon,
  RoboticIcon,
  Settings02Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

export type MenuHref =
  | "/decisions"
  | "/inbox"
  | "/leads"
  | "/overview"
  | "/employees"
  | "/settings"

export type MenuItem = {
  name: string
  href: MenuHref
  icon: IconSvgElement
}

export type MenuCategory = {
  name: string
  items: MenuItem[]
}

// The work band, in §3 order: Leads, Inbox, Decisions, Mission Control. Each
// item lands in the same change as its route — never before, or the nav
// promises a page that 404s. `/leads` is the labelled placeholder until P19
// ships the pipeline; `/prospects` is a redirect, not a second entry.
//
// Neither count badge is declared here, and deliberately so: Decisions' badge
// comes from `useOpenDecisionCount` and Inbox's from `useInboxAttention` —
// the same hook and arguments the attention surfaces use, one call each. Two
// sources for one count is a defect.
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
    name: "Decisions",
    href: "/decisions",
    icon: UserCheck01Icon,
  },
  {
    name: "Overview",
    href: "/overview",
    icon: Home01Icon,
  },
]

export const sidebarCategories: MenuCategory[] = [
  {
    name: "Workspace",
    items: [
      {
        name: "Employees",
        href: "/employees",
        icon: RoboticIcon,
      },
    ],
  },
]

export const sidebarFooterItems: MenuItem[] = [
  {
    name: "Settings",
    href: "/settings",
    icon: Settings02Icon,
  },
]
