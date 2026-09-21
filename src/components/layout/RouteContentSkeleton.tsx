import { useRouterState } from "@tanstack/react-router"
import type { ComponentType } from "react"
import { AgentPageSkeleton } from "@/components/agent/AgentPageSkeleton"
import { SignalsPageSkeleton } from "@/components/agent/SignalsPageSkeleton"
import { BillingPageSkeleton } from "@/components/billing/BillingPageSkeleton"
import { BILLING_TABS } from "@/components/billing/billing-model"
import { ContactsPageSkeleton } from "@/components/contacts/ContactsPageSkeleton"
import { DashboardPageSkeleton } from "@/components/dashboard/DashboardPageSkeleton"
import { InboxPageSkeleton } from "@/components/inbox/InboxPageSkeleton"
import { IntegrationsPageSkeleton } from "@/components/integrations/IntegrationsPageSkeleton"
import { LeadsPageSkeleton } from "@/components/leads/LeadsPageSkeleton"
import { SettingsPageSkeleton } from "@/components/settings/SettingsPageSkeleton"
import { SETTINGS_TABS } from "@/components/settings/settings-model"
import {
  PageTitleSkeleton,
  SkeletonRegion,
  TableSkeleton,
} from "@/components/states/skeletons"
import { TeamPageSkeleton } from "@/components/team/TeamPageSkeleton"
import { optionalOneOf } from "@/lib/search-params"

const PAGE_SKELETONS: Record<string, ComponentType> = {
  "/overview": DashboardPageSkeleton,
  "/signals": SignalsPageSkeleton,
  "/autopilot": AgentPageSkeleton,
  "/leads": LeadsPageSkeleton,
  "/contacts": ContactsPageSkeleton,
  "/inbox": InboxPageSkeleton,
  "/integrations": IntegrationsPageSkeleton,
  "/team": TeamPageSkeleton,
}

/** The page skeleton for whichever dashboard route is opening, so gates that
 * wait above the page (auth, organization, agent) show the page's own shape. */
export function RouteContentSkeleton() {
  const location = useRouterState({ select: (state) => state.location })
  const section = `/${location.pathname.split("/")[1] ?? ""}`
  const search = location.search as Record<string, unknown>

  if (section === "/settings") {
    return <SettingsPageSkeleton tab={optionalOneOf(SETTINGS_TABS, search.tab)} />
  }
  if (section === "/billing") {
    return <BillingPageSkeleton tab={optionalOneOf(BILLING_TABS, search.tab)} />
  }

  const Page = PAGE_SKELETONS[section]
  if (Page !== undefined) {
    return <Page />
  }
  return (
    <SkeletonRegion label="Loading">
      <PageTitleSkeleton />
      <TableSkeleton />
    </SkeletonRegion>
  )
}
