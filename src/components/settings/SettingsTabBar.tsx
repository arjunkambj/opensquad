import { Link } from "@tanstack/react-router"
import {
  SETTINGS_TABS,
  SETTINGS_TAB_LABEL,
} from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { cn } from "@/lib/utils"

/** Vertical section nav on wide screens; a scrolling row on narrow ones. */
export function SettingsTabBar({ current }: { current: SettingsTab }) {
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-3">
      <p className="hidden px-3 text-xs font-medium tracking-widest text-muted-foreground uppercase md:block">
        Settings
      </p>
      <ul className="-mx-1 flex gap-0.5 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {SETTINGS_TABS.map((value) => {
          const active = value === current
          return (
            <li key={value} className="shrink-0">
              <Link
                to="/settings"
                search={{ tab: value }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-7.5 items-center rounded-xl px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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
