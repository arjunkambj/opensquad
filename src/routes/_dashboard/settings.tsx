import { useUser } from "@hexclave/react"
import { Link, createFileRoute, useSearch } from "@tanstack/react-router"
import { optionalOneOf } from "@/lib/search-params"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { AccountSection } from "@/components/settings/AccountSection"
import { SettingsSections } from "@/components/settings/SettingsSections"
import { LoadingState } from "@/components/states/states"
import { Chip } from "@/components/decisions/decision-presentation"
import { cn } from "@/lib/utils"

/**
 * `?section=` rather than seven route files. The requirement is a deep link: a
 * `connection_required` decision must be able to point at the runtime
 * controls, and a send blocked by the policy window at the sending policy.
 * One `validateSearch` delivers that; seven route files deliver the same thing
 * and a week we do not have.
 */
export const SETTINGS_SECTIONS = [
  "account",
  "workspace",
  "sending",
  "automation",
  "members",
  "runtime",
  "integrations",
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "workspace"

export const Route = createFileRoute("/_dashboard/settings")({
  validateSearch: (search): { section?: SettingsSection } => ({
    section: optionalOneOf(SETTINGS_SECTIONS, search.section),
  }),
  component: SettingsPage,
})

const SECTION_LABEL: Record<SettingsSection, string> = {
  account: "Account",
  workspace: "Workspace",
  sending: "Sending",
  automation: "Automation",
  members: "Members",
  runtime: "Runtime",
  integrations: "Integrations",
}

/**
 * The sections whose write controls belong to the owner alone. Marked BEFORE
 * the user opens them (`plan/ux.md` §5) so a non-owner learns from the nav
 * why a control will not be there — not after opening the card and hunting
 * for it. `sending` is marked too: its suppression list is editor-writable,
 * but the policy itself is owner-only.
 */
const OWNER_ONLY: ReadonlySet<SettingsSection> = new Set([
  "workspace",
  "sending",
  "automation",
  "members",
  "runtime",
])

function SettingsPage() {
  const user = useUser()
  const search = useSearch({ from: "/_dashboard/settings" })
  const section = search.section ?? DEFAULT_SETTINGS_SECTION

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
        description="Your profile and workspace preferences."
      />
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-1.5"
      >
        {SETTINGS_SECTIONS.map((value) => {
          const active = section === value
          return (
            <Link
              key={value}
              to="/settings"
              search={{ section: value }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {SECTION_LABEL[value]}
              {OWNER_ONLY.has(value) ? (
                <Chip className="px-1.5 py-0 text-[10px]">owner</Chip>
              ) : null}
            </Link>
          )
        })}
      </nav>
      {section === "account" ? (
        <AccountSection user={user} />
      ) : (
        <SettingsSections section={section} />
      )}
    </div>
  )
}
