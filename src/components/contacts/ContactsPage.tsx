import { LeadList } from "@/components/contacts/LeadList"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

/**
 * `/contacts` — everyone the agent has found, and where each one stands.
 *
 * The container owns the workspace read; the table below owns the list query
 * and the URL filters. T31 rebuilds the body against reference 23.
 */
export function ContactsPage() {
  const current = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Contacts"
        description="Everyone your agent found, what it learned about them, and what happens next."
      />
      {/* `null` cannot reach here — the `_workspace` gate redirects a
          membership-less user to setup — but loading is the only honest
          render for a case that resolves elsewhere. */}
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading contacts"
          description="Reading this workspace's pipeline."
        />
      ) : (
        <LeadList workspaceId={current.workspace._id} />
      )}
    </div>
  )
}
