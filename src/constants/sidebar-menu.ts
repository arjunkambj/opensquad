import {
  AudioLinesIcon,
  ContactBookIcon,
  CreditCardIcon,
  Home02Icon,
  InboxIcon,
  PlugSocketIcon,
  Robot01Icon,
  Settings02Icon,
  UserGroupIcon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

type MenuHref =
  | "/overview"
  | "/signals"
  | "/autopilot"
  | "/leads"
  | "/contacts"
  | "/inbox"
  | "/settings"
  | "/billing"
  | "/team"
  | "/integrations"

export type MenuItem = {
  name: string
  href: MenuHref
  icon: IconSvgElement
}

/** Sits above every section, unlabelled: the overview belongs to no category. */
export const sidebarOverviewItem: MenuItem = {
  name: "Overview",
  href: "/overview",
  icon: Home02Icon,
}

export type MenuSection = {
  label: string
  items: MenuItem[]
}

export const sidebarSections: MenuSection[] = [
  {
    label: "Agent",
    items: [
      {
        name: "Signals",
        href: "/signals",
        icon: AudioLinesIcon,
      },
      {
        name: "Autopilot",
        href: "/autopilot",
        icon: Robot01Icon,
      },
    ],
  },
  {
    label: "Pipeline",
    items: [
      {
        name: "Leads",
        href: "/leads",
        icon: UserMultipleIcon,
      },
      {
        name: "Contacts",
        href: "/contacts",
        icon: ContactBookIcon,
      },
      {
        name: "Inbox",
        href: "/inbox",
        icon: InboxIcon,
      },
    ],
  },
]

export const sidebarFooterItems: MenuItem[] = [
  {
    name: "Team",
    href: "/team",
    icon: UserGroupIcon,
  },
  {
    name: "Integrations",
    href: "/integrations",
    icon: PlugSocketIcon,
  },
  {
    name: "Billing",
    href: "/billing",
    icon: CreditCardIcon,
  },
  {
    name: "Settings",
    href: "/settings",
    icon: Settings02Icon,
  },
]
