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
