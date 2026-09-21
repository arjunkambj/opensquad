/** Billing sits under the `_org` gate, so an organization with a finished setup is guaranteed here. */
import { useSearch } from "@tanstack/react-router"
import { BillingTabSkeleton } from "@/components/billing/BillingPageSkeleton"
import { BillingTabBar } from "@/components/billing/BillingTabBar"
import {
  BILLING_TAB_DESCRIPTION,
  DEFAULT_BILLING_TAB,
} from "@/components/billing/billing-model"
import { PlansTab } from "@/components/billing/PlansTab"
import { UsageTab } from "@/components/billing/usage/UsageTab"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { SkeletonRegion } from "@/components/states/skeletons"
import { useCurrentOrgId } from "@/hooks/use-current-org"

export function BillingPage() {
  const search = useSearch({ from: "/_dashboard/_org/billing" })
  const tab = search.tab ?? DEFAULT_BILLING_TAB
  const orgId = useCurrentOrgId()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Billing"
        description={BILLING_TAB_DESCRIPTION[tab]}
      />
      <BillingTabBar current={tab} />
      {orgId === undefined ? (
        <SkeletonRegion label="Loading billing">
          <BillingTabSkeleton tab={tab} />
        </SkeletonRegion>
      ) : tab === "usage" ? (
        <UsageTab orgId={orgId} />
      ) : (
        <PlansTab orgId={orgId} />
      )}
    </div>
  )
}
