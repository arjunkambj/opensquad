import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { CreditBalanceCard } from "@/components/billing/usage/CreditBalanceCard"
import { UsageHistory } from "@/components/billing/usage/UsageHistory"
import { EmptyState } from "@/components/states/states"

export function UsageTab({ orgId }: { orgId: Id<"orgs"> }) {
  const balance = useQuery(api.billing.credits.balance, { orgId })

  return (
    <div className="flex flex-col gap-6">
      {balance === null ? (
        <EmptyState
          title="No credits granted"
          description="Finishing setup creates the credit grant."
        />
      ) : (
        <CreditBalanceCard balance={balance} />
      )}

      <UsageHistory orgId={orgId} />
    </div>
  )
}
