/**
 * Settings → Usage (reference 26, PLAN §6).
 *
 * The one credit number a member sees, and what it went on. Neutral by
 * construction: the balance query returns granted / remaining / pending and
 * the history returns an action key, so no provider name, provider unit or
 * hidden cap can reach this screen.
 *
 * There is no refill, no upgrade and no price list, because there is none —
 * one lifetime grant per org (PLAN §6), and a button offering more
 * would be a button that does nothing.
 */
import { Coins01Icon } from "@hugeicons/core-free-icons"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { StatCard } from "@/components/kit/StatCard"
import { SectionHeaderCard } from "@/components/settings/SectionHeaderCard"
import { UsageHistory } from "@/components/settings/usage/UsageHistory"
import { EmptyState } from "@/components/states/states"

export function UsageTab({ orgId }: { orgId: Id<"orgs"> }) {
  const balance = useQuery(api.billing.credits.balance, { orgId })
  const loading = balance === undefined

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <SectionHeaderCard
        icon={Coins01Icon}
        title="Credits"
        description="One grant per organization. Browsing, approving, sending and handling unsubscribes are free and never touch it."
      />

      {/* `null` is not zero: the org holds no grant at all, so every
          paid step refuses for a different reason than an empty balance. */}
      {balance === null ? (
        <EmptyState
          title="No credits granted"
          description="This organization has no credit grant, so paid steps — finding emails, researching companies, writing email — will refuse. Finishing setup creates the grant."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            hint="Ready to spend."
            label="Remaining"
            loading={loading}
            value={balance?.remaining ?? 0}
          />
          <StatCard
            hint="Held while a step is still out; billed or given back when it settles."
            label="Pending"
            loading={loading}
            value={balance?.pending ?? 0}
          />
          <StatCard
            hint="The lifetime grant this organization was created with."
            label="Granted"
            loading={loading}
            value={balance?.granted ?? 0}
          />
        </div>
      )}

      <UsageHistory orgId={orgId} />
    </div>
  )
}
