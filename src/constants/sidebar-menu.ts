import {
  Home01Icon,
  RoboticIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

export type MenuHref = "/overview" | "/employees" | "/settings"

export type MenuItem = {
  name: string
  href: MenuHref
  icon: IconSvgElement
}

export type MenuCategory = {
  name: string
  items: MenuItem[]
}

export const sidebarMainItems: MenuItem[] = [
  {
    name: "Overview",
    href: "/overview",
    icon: Home01Icon,
  },
]

// §10 target list also includes Leads, Inbox and Decisions — those routes do
// not exist until P12/P13, so they are deliberately not linked here yet.
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
