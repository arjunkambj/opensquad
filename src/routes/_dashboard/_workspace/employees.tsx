import { createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { EmployeesView } from "@/components/employees/EmployeesView"

export const Route = createFileRoute("/_dashboard/_workspace/employees")({
  component: EmployeesPage,
})

function EmployeesPage() {
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Employees"
        description="Scout, Researcher and Outreach — their names, versioned instructions and real status."
      />
      <EmployeesView />
    </div>
  )
}
