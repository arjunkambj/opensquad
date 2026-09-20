/**
 * Settings (reference 26): a page title, one horizontal tab bar, and the
 * selected section as a stack of cards.
 *
 * This is the frame and the gate, nothing more. It resolves the signed-in
 * user and the active organization once — every tab needs both — and hands
 * each section the org id. The sections own their own Convex reads and
 * writes, because a tab that is not open must not be subscribed to anything.
 *
 * Account is the one section that renders without an organization: it is an
 * identity surface, and someone who has left every organization must still be
 * able to see who they are signed in as and sign out.
 */
import { useUser } from "@hexclave/react"
import { useSearch } from "@tanstack/react-router"
import { AccountTab } from "@/components/settings/account/AccountTab"
import { BlocklistTab } from "@/components/settings/blocklist/BlocklistTab"
import { CompanyTab } from "@/components/settings/company/CompanyTab"
import { InboxTab } from "@/components/settings/InboxTab"
import { OutreachTab } from "@/components/settings/outreach/OutreachTab"
import { SendingTab } from "@/components/settings/sending/SendingTab"
import { SettingsTabBar } from "@/components/settings/SettingsTabBar"
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TAB_DESCRIPTION,
} from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { UsageTab } from "@/components/settings/usage/UsageTab"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { EmptyState, LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"
import type { OrgView } from "@/lib/org-view"

export function SettingsPage() {
  const user = useUser()
  const search = useSearch({ from: "/_dashboard/settings" })
  const tab = search.tab ?? DEFAULT_SETTINGS_TAB
  const current = useCurrentOrg()

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
        description={SETTINGS_TAB_DESCRIPTION[tab]}
      />
      <SettingsTabBar current={tab} />
      {tab === "account" ? (
        <AccountTab user={user} />
      ) : current.status === "loading" ? (
        <LoadingState
          title="Loading your organization"
          description="Reading your company profile, sending policy and blocklist."
        />
      ) : current.status !== "ready" ? (
        <EmptyState
          title="Nothing to configure yet"
          description="These settings appear once setup has run once. Finish setup and come back."
        />
      ) : (
        <OrgTab tab={tab} org={current.org} />
      )}
    </div>
  )
}

/** The org-scoped sections. Account is rendered by the page above. */
function OrgTab({ tab, org }: { tab: SettingsTab; org: OrgView }) {
  switch (tab) {
    case "company":
      return <CompanyTab orgId={org._id} />
    case "inbox":
      // The connect / verify / sync flow of PLAN §4, shared with onboarding
      // dot 3; it resolves the active organization itself before reading.
      return <InboxTab orgId={org._id} />
    case "outreach":
      return <OutreachTab orgId={org._id} />
    case "blocklist":
      return <BlocklistTab orgId={org._id} />
    case "sending":
      return <SendingTab org={org} />
    case "usage":
      return <UsageTab orgId={org._id} />
    case "account":
      return null
  }
}
