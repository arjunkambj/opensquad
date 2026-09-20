/**
 * Settings (reference 26): a page title, one horizontal tab bar, and the
 * selected section as a stack of cards.
 *
 * This is the frame and the gate, nothing more. It resolves the signed-in
 * user and the current workspace once — every tab needs both — and hands each
 * section the workspace id and the caller's role. The sections own their own
 * Convex reads and writes, because a tab that is not open must not be
 * subscribed to anything.
 *
 * Account is the one section that renders without a workspace: it is an
 * identity surface, and someone whose membership was revoked must still be
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
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"
import type { WorkspaceRole } from "@/lib/workspace-role"
import type { WorkspaceView } from "@/lib/workspace-view"

export function SettingsPage() {
  const user = useUser()
  const search = useSearch({ from: "/_dashboard/settings" })
  const tab = search.tab ?? DEFAULT_SETTINGS_TAB
  const current = useCurrentWorkspace()

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
      ) : current === undefined ? (
        <LoadingState
          title="Loading your organization"
          description="Reading your company profile, sending policy and blocklist."
        />
      ) : current === null ? (
        <EmptyState
          title="Nothing to configure yet"
          description="These settings appear once setup has run once. Finish setup and come back."
        />
      ) : (
        <WorkspaceTab
          tab={tab}
          workspace={current.workspace}
          role={current.role}
        />
      )}
    </div>
  )
}

/** The workspace-scoped sections. Account is rendered by the page above. */
function WorkspaceTab({
  tab,
  workspace,
  role,
}: {
  tab: SettingsTab
  workspace: WorkspaceView
  role: WorkspaceRole
}) {
  switch (tab) {
    case "company":
      return <CompanyTab workspaceId={workspace._id} role={role} />
    case "inbox":
      // The connect / verify / sync flow of PLAN §4, shared with onboarding
      // dot 3; it does its own owner check, because the read is owner-guarded.
      return <InboxTab workspaceId={workspace._id} />
    case "outreach":
      return <OutreachTab workspaceId={workspace._id} role={role} />
    case "blocklist":
      return <BlocklistTab workspaceId={workspace._id} role={role} />
    case "sending":
      return <SendingTab workspace={workspace} role={role} />
    case "usage":
      return <UsageTab workspaceId={workspace._id} />
    case "account":
      return null
  }
}
