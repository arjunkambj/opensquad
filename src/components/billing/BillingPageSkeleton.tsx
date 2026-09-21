import { PlansTabSkeleton } from "@/components/billing/PlansTab"
import { DEFAULT_BILLING_TAB } from "@/components/billing/billing-model"
import type { BillingTab } from "@/components/billing/billing-model"
import { UsageTabSkeleton } from "@/components/billing/usage/UsageTabSkeleton"
import {
  PageTitleSkeleton,
  SkeletonRegion,
} from "@/components/states/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Mirrors `BillingPage`: title, the tab row, then the open tab. */
export function BillingPageSkeleton({
  tab = DEFAULT_BILLING_TAB,
}: {
  tab?: BillingTab
}) {
  return (
    <SkeletonRegion label="Loading billing">
      <PageTitleSkeleton />
      <Skeleton shape="xl" className="h-8 w-36" />
      <BillingTabSkeleton tab={tab} />
    </SkeletonRegion>
  )
}

export function BillingTabSkeleton({ tab }: { tab: BillingTab }) {
  return tab === "usage" ? <UsageTabSkeleton /> : <PlansTabSkeleton />
}
