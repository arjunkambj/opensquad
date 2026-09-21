import { useNavigate } from "@tanstack/react-router"
import {
  BILLING_TABS,
  BILLING_TAB_LABEL,
} from "@/components/billing/billing-model"
import type { BillingTab } from "@/components/billing/billing-model"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function BillingTabBar({ current }: { current: BillingTab }) {
  const navigate = useNavigate()
  return (
    <Tabs
      value={current}
      onValueChange={(tab: BillingTab) =>
        void navigate({ to: "/billing", search: { tab } })
      }
    >
      <TabsList aria-label="Billing sections">
        {BILLING_TABS.map((value) => (
          <TabsTrigger key={value} value={value}>
            {BILLING_TAB_LABEL[value]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
