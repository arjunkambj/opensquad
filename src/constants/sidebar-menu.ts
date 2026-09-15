import {
  Home01Icon,
  RoboticIcon,
  Settings02Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

export type MenuHref =
  | "/decisions"
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

// The work band, in §3 order. Leads and Inbox belong ahead of Decisions but
// their routes do not exist yet, and an item is added in the same change as
// its route — never before, or the nav promises a page that 404s.
//
// The Decisions count badge is NOT declared here, and deliberately so: it
// lives in `AppSidebar.tsx`, which reads it through the same
// `useOpenDecisionCount` hook the home attention block uses, with identical
// arguments. Two sources for one count is a defect, so there is one call.
export const sidebarMainItems: MenuItem[] = [
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
