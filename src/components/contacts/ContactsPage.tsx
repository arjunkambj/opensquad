import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentOrg } from "@/hooks/use-current-org"
import { ContactsBody } from "./ContactsBody"

export function ContactsPage() {
  const current = useCurrentOrg()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Contacts"
        description="Everyone your agent found, what it learned about them, and what happens next."
      />
      {current.status === "ready" ? (
        <ContactsBody orgId={current.org._id} />
      ) : (
        <LoadingState
          title="Loading contacts"
          description="Reading this organization's pipeline."
        />
      )}
    </div>
  )
}
