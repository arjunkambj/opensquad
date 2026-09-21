export const BILLING_TABS = ["usage", "plans"] as const

export type BillingTab = (typeof BILLING_TABS)[number]

export const DEFAULT_BILLING_TAB: BillingTab = "usage"

export const BILLING_TAB_LABEL: Record<BillingTab, string> = {
  usage: "Usage",
  plans: "Plans",
}

export const BILLING_TAB_DESCRIPTION: Record<BillingTab, string> = {
  usage: "What your credits have been spent on.",
  plans: "The plan this organization is on, and what comes next.",
}
