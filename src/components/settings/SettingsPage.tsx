/** Account remains accessible without completed setup. Every org-scoped tab applies the setup gate. */
import { useUser } from "@hexclave/react"
import { Link, useSearch } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { AccountTab } from "@/components/settings/account/AccountTab"
import { BlocklistTab } from "@/components/settings/blocklist/BlocklistTab"
import { CompanyTab } from "@/components/settings/company/CompanyTab"
import { OutreachTab } from "@/components/settings/outreach/OutreachTab"
import { SendingTab } from "@/components/settings/sending/SendingTab"
import { SettingsTabBar } from "@/components/settings/SettingsTabBar"
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TAB_DESCRIPTION,
  SETTINGS_TAB_LABEL,
} from "@/components/settings/settings-model"
import type { SettingsTab } from "@/components/settings/settings-model"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { SettingsPageSkeleton } from "@/components/settings/SettingsPageSkeleton"
import { SettingsTabSkeleton } from "@/components/settings/SettingsTabSkeletons"
import { SkeletonRegion } from "@/components/states/skeletons"
import { EmptyState } from "@/components/states/states"
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
    return <SettingsPageSkeleton tab={tab} />
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-12">
      <aside className="md:sticky md:top-6 md:w-52 md:shrink-0 md:self-start">
        <SettingsTabBar current={tab} />
      </aside>
      <div className="flex max-w-3xl min-w-0 flex-1 flex-col gap-6">
        <DashboardPageTitle
          title={SETTINGS_TAB_LABEL[tab]}
          description={SETTINGS_TAB_DESCRIPTION[tab]}
        />
        {tab === "account" ? (
          <AccountTab user={user} />
        ) : (
          <OrgSection tab={tab} />
        )}
      </div>
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
    return <OrgTabSkeleton tab={tab} />
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
    return <OrgTabSkeleton tab={tab} />
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

function OrgTabSkeleton({ tab }: { tab: SettingsTab }) {
  return (
    <SkeletonRegion label="Loading your organization">
      <SettingsTabSkeleton tab={tab} />
    </SkeletonRegion>
  )
}

function OrgTab({ tab, org }: { tab: SettingsTab; org: OrgView }) {
  switch (tab) {
    case "company":
      return <CompanyTab orgId={org._id} />
    case "outreach":
      return <OutreachTab orgId={org._id} />
    case "blocklist":
      return <BlocklistTab orgId={org._id} />
    case "sending":
      return <SendingTab org={org} />
    case "account":
      return null
  }
}
