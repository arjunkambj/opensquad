import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { LeadsBody } from "./LeadsBody"
import { LeadsPageSkeleton } from "./LeadsPageSkeleton"

export function LeadsPage() {
  const current = useCurrentOrg()

  if (current.status !== "ready") {
    return <LeadsPageSkeleton />
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Leads"
        description="Everyone your agent found, what it learned about them, and what happens next."
      />
      <LeadsBody orgId={current.org._id} />
    </div>
  )
}
