/**
 * Settings (reference 26): a page title, one horizontal tab bar, and the
 * selected section as a stack of cards.
 *
 * This is the frame and the gate, nothing more: it resolves the signed-in
 * user, and `OrgSection` below resolves the organization every other tab
 * needs and hands it down as an id. The sections own their own Convex reads
 * and writes, because a tab that is not open must not be subscribed to
 * anything.
 *
 * THE GUARD IS PER TAB, WHICH IS WHY THE ROUTE SITS OUTSIDE `_org`. PLAN §5
 * puts `/settings` behind the same condition as `/dashboard` — an org whose
 * setup is finished — and every org-scoped tab here enforces exactly that.
 * Account is the one section that does not: it is an identity surface, and
 * someone with no organization, or one still half-set-up, must still be able
 * to see who they are signed in as and sign out. Gating the whole route would
 * take that away, so the route stays open and the sections that need an agent
 * say so themselves.
 */
import { useUser } from "@hexclave/react"
import { Link, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
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
import { Button } from "@/components/ui/button"
import { useCurrentOrg } from "@/hooks/use-current-org"
import type { OrgView } from "@/lib/org-view"

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
        description={SETTINGS_TAB_DESCRIPTION[tab]}
      />
      <SettingsTabBar current={tab} />
      {tab === "account" ? <AccountTab user={user} /> : <OrgSection tab={tab} />}
    </div>
  )
}

/**
 * `_org`'s two conditions, applied to one tab instead of a whole route: an
 * organization row, and an agent that has finished setup. A half-set-up
 * organization has a company profile and a sending policy the wizard is still
 * writing, so editing them from here would be two screens saving the same
 * record with two different ideas of what is in it.
 */
function OrgSection({ tab }: { tab: SettingsTab }) {
  const current = useCurrentOrg()
  const orgId = current.status === "ready" ? current.org._id : undefined
  // Skipped until the organization resolves: the agent is org-scoped and the
  // query would have nothing to read.
  const agent = useQuery(
    api.agents.queries.get,
    orgId === undefined ? "skip" : { orgId },
  )

  if (current.status === "loading") {
    return (
      <LoadingState
        title="Loading your organization"
        description="Reading your company profile, sending policy and blocklist."
      />
    )
  }

  if (current.status !== "ready") {
    return (
      <EmptyState
        title="Nothing to configure yet"
        description="These settings appear once setup has run once. Finish setup and come back."
      />
    )
  }

  if (agent === undefined) {
    return (
      <LoadingState
        title="Loading your organization"
        description="Checking how far setup got."
      />
    )
  }

  if (agent === null || agent.onboardingStep !== "done") {
    return (
      <EmptyState
        title="Finish setting up your agent first"
        description="Setup is still writing the company profile and the sending policy these tabs edit. It resumes exactly where you left it."
        action={<Button render={<Link to="/onboarding" />}>Resume setup</Button>}
      />
    )
  }

  return <OrgTab tab={tab} org={current.org} />
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
