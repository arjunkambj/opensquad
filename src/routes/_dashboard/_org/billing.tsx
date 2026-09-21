import { createFileRoute } from "@tanstack/react-router"
import { BillingPage } from "@/components/billing/BillingPage"
import { BILLING_TABS } from "@/components/billing/billing-model"
import type { BillingTab } from "@/components/billing/billing-model"
import { optionalOneOf } from "@/lib/search-params"

export const Route = createFileRoute("/_dashboard/_org/billing")({
  validateSearch: (search): { tab?: BillingTab } => ({
    tab: optionalOneOf(BILLING_TABS, search.tab),
  }),
  component: BillingPage,
})
