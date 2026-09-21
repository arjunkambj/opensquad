import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { useCurrentOrgId } from "@/hooks/use-current-org"
import { SignalsCard } from "./SignalsCard"
import { SignalsPageSkeleton } from "./SignalsPageSkeleton"
import { SignalsSummary } from "./SignalsSummary"

/** The searches the agent runs to find leads. Sits under the `_org` gate, so setup is finished here. */
export function SignalsPage() {
  const orgId = useCurrentOrgId()
  const strategies = useQuery(
    api.leads.counts.byStrategy,
    orgId === undefined ? "skip" : { orgId },
  )

  if (orgId === undefined) {
    return <SignalsPageSkeleton />
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Signals"
        description="The searches your agent runs to find leads. Changes apply on the next run."
      />
      <SignalsSummary strategies={strategies} />
      <SignalsCard orgId={orgId} strategies={strategies} />
    </div>
  )
}
