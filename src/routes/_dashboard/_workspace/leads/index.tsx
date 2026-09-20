import { Link, createFileRoute } from "@tanstack/react-router"
import { AttentionBlock } from "@/components/leads/AttentionBlock"
import { LeadList } from "@/components/leads/LeadList"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

export const Route = createFileRoute("/_dashboard/_workspace/leads/")({
  component: LeadsPage,
})

/**
 * `/leads` — the signed-in home and the CRM list. Overview is a named
 * action, not a vanished page: the operator arrives at the pipeline and can
 * still reach the workspace's receipts from the top bar.
 */
function LeadsPage() {
  const current = useCurrentWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Leads"
        description="Every company the agent has found, and what each one is waiting on. Overview — what has happened in this workspace — stays linked at the top."
        actions={
          <Button variant="outline" size="sm" render={<Link to="/overview" />}>
            Overview
          </Button>
        }
      />
      {current === undefined || current === null ? (
        <LoadingState
          title="Loading leads"
          description="Reading this workspace's pipeline."
        />
      ) : (
        <>
          <AttentionBlock workspaceId={current.workspace._id} />
          <LeadList
            workspaceId={current.workspace._id}
            timezone={current.workspace.timezone}
          />
        </>
      )}
    </div>
  )
}
