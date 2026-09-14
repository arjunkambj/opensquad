import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { EmployeeTemplate } from "../../../convex/lib/validators"
import { EmployeeCard } from "@/components/employees/EmployeeCard"
import { EmptyState, LoadingState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { useCurrentWorkspace } from "@/hooks/use-current-workspace"

const TEMPLATE_ORDER: readonly EmployeeTemplate[] = [
  "scout",
  "researcher",
  "outreach",
]

/**
 * The three employee cards. Status comes only from real backend state:
 * `employee.enabled` plus the P07 runtime's live signal
 * (`runtimeConnections.getStatus`). With no connected runtime every enabled
 * employee truthfully shows disconnected — never a simulated busy.
 */
export function EmployeesView() {
  const current = useCurrentWorkspace()

  const employees = useQuery(
    api.employees.list,
    current !== undefined && current !== null
      ? { workspaceId: current.workspace._id }
      : "skip",
  )
  const runtime = useQuery(
    api.runtimeConnections.getStatus,
    current !== undefined && current !== null
      ? { workspaceId: current.workspace._id }
      : "skip",
  )

  if (current === undefined) {
    return (
      <LoadingState
        title="Loading employees"
        description="Reading your workspace's Scout, Researcher and Outreach."
      />
    )
  }

  if (current === null) {
    return (
      <EmptyState
        title="No workspace yet"
        description="Complete setup to provision Scout, Researcher and Outreach."
        action={<Button render={<Link to="/onboarding" />}>Start setup</Button>}
      />
    )
  }

  if (employees === undefined || runtime === undefined) {
    return (
      <LoadingState
        title="Loading employees"
        description="Reading your workspace's Scout, Researcher and Outreach."
      />
    )
  }

  if (employees.length === 0) {
    return (
      <EmptyState
        title="No employees found"
        description="This workspace has no employee records. They are created automatically when a workspace is provisioned — try finishing setup."
        action={<Button render={<Link to="/onboarding" />}>Open setup</Button>}
      />
    )
  }

  const canEdit = current.role === "owner" || current.role === "operator"
  const runtimeAvailability =
    runtime !== undefined && runtime.exists && runtime.live
      ? "connected"
      : "disconnected"
  const sorted = [...employees].sort(
    (a, b) =>
      TEMPLATE_ORDER.indexOf(a.template) - TEMPLATE_ORDER.indexOf(b.template),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {sorted.map((employee) => (
          <EmployeeCard
            key={employee._id}
            workspaceId={current.workspace._id}
            employee={employee}
            canEdit={canEdit}
            runtime={runtimeAvailability}
          />
        ))}
      </div>
      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          You have read-only access — ask an owner or operator to change
          instructions.
        </p>
      ) : null}
    </div>
  )
}
