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
// No count badge on Decisions. §3 allows one, fed by `decisions.listOpen` and
// rendered as `50+` past the page bound; the badge itself lives in
// `AppSidebar.tsx`, which this change does not own. A number here would also
// have to be the same number the home attention block shows, from the same
// query call — two sources for one count is a defect, so it waits for the
// change that can do both.
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
