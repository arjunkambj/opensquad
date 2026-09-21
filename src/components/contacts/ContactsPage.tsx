import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { ContactsBody } from "./ContactsBody"
import { ContactsPageSkeleton } from "./ContactsPageSkeleton"

export function ContactsPage() {
  const current = useCurrentOrg()

  if (current.status !== "ready") {
    return <ContactsPageSkeleton />
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Contacts"
        description="People your agent found whose email you can still reveal."
      />
      <ContactsBody orgId={current.org._id} />
    </div>
  )
}
