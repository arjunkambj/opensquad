/**
 * `/contacts` — everyone the agent found, what it learned about them, and
 * what happens next (ref 23).
 *
 * The screen's shell: the title, and the one gate the body cannot render
 * without. `ContactsBody` is the container that owns every Convex call here,
 * and the table, the filters, the bulk bar and the drawer under it are
 * presentational.
 */
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
      {/* Anything but `ready` cannot reach here — the `_org` gate sends a
          caller with no organization row to setup — but loading is the only
          honest render for a case that resolves elsewhere. */}
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
