/**
 * The horizontal settings tab bar (reference 26).
 *
 * Links rather than a `Tabs` widget: `?tab=` is a deep link other screens
 * point at — a blocked send links to Sending, the sidebar's inbox status to
 * Inbox — so each tab has to be a real, shareable, back-button-able URL.
 *
 * The bar scrolls horizontally on a narrow screen instead of wrapping, which
 * keeps the row of section names reading as one row at every width.
 */
import { Link } from "@tanstack/react-router"
import {
  SETTINGS_TABS,
  SETTINGS_TAB_LABEL,
} from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { cn } from "@/lib/utils"

export function SettingsTabBar({ current }: { current: SettingsTab }) {
  return (
    <nav aria-label="Settings sections" className="border-b border-border">
      <ul className="-mb-px flex items-center gap-1 overflow-x-auto pb-2">
        {SETTINGS_TABS.map((value) => {
          const active = value === current
          return (
            <li key={value}>
              <Link
                to="/settings"
                search={{ tab: value }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-xl px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  active
                    ? "border border-border bg-card font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {SETTINGS_TAB_LABEL[value]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
