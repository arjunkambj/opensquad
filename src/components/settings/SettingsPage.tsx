import { useUser } from "@hexclave/react"
import { Link, useSearch } from "@tanstack/react-router"
import { AccountSection } from "@/components/settings/AccountSection"
import { SettingsSections } from "@/components/settings/SettingsSections"
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  SETTINGS_TAB_LABEL,
} from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { Chip } from "@/components/shared/presentation"
import { cn } from "@/lib/utils"

/**
 * The tabs whose write controls belong to the owner alone. Marked BEFORE the
 * user opens them so a non-owner learns from the tab bar why a control will
 * not be there — not after opening the card and hunting for it. `sending` is
 * marked too: its blocklist is editor-writable, but the policy itself is
 * owner-only.
 */
const OWNER_ONLY: ReadonlySet<SettingsTab> = new Set([
  "company",
  "inbox",
  "outreach",
  "sending",
])

export function SettingsPage() {
  const user = useUser()
  const search = useSearch({ from: "/_dashboard/settings" })
  const tab = search.tab ?? DEFAULT_SETTINGS_TAB

  // `useUser()` resolves asynchronously; a null under `_dashboard` is a
  // session the shell is still checking or redirecting — loading is the
  // honest render, never a blank.
  if (!user) {
    return <LoadingState title="Loading settings" />
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Settings"
        description="Your company profile, how the agent sends, and who it may never contact."
      />
      <nav
        aria-label="Settings tabs"
        className="flex flex-wrap gap-1.5 border-b border-border pb-3"
      >
        {SETTINGS_TABS.map((value) => {
          const active = tab === value
          return (
            <Link
              key={value}
              to="/settings"
              search={{ tab: value }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {SETTINGS_TAB_LABEL[value]}
              {OWNER_ONLY.has(value) ? (
                <Chip
                  className={cn(
                    "px-1.5 py-0 text-[10px]",
                    active && "bg-primary-foreground/20 text-primary-foreground",
                  )}
                >
                  owner
                </Chip>
              ) : null}
            </Link>
          )
        })}
      </nav>
      {tab === "account" ? (
        <AccountSection user={user} />
      ) : (
        <SettingsSections tab={tab} />
      )}
    </div>
  )
}
