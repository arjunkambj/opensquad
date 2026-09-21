import { CreditBalanceCard } from "@/components/billing/usage/CreditBalanceCard"
import { UsageHistorySkeleton } from "@/components/billing/usage/UsageHistory"

/** Mirrors `UsageTab`: the credits panel in its loading state, then the history. */
export function UsageTabSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <CreditBalanceCard balance={undefined} />
      <UsageHistorySkeleton />
    </div>
  )
}
