import {
  DashboardSquare01Icon,
  InboxIcon,
  Robot01Icon,
  Settings02Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

type MenuHref =
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
