import { Link, useParams } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export function DashboardNotFound() {
  const { _splat } = useParams({ from: "/_dashboard/$" })
  const attempted = _splat === undefined ? undefined : `/${_splat}`

  return (
    <>
      <DashboardPageTitle
        title="Page not found"
        description="That address does not match a page in this organization."
      />
      <EmptyState
        title={attempted ?? "Page not found"}
        description="Check the address, or pick a page from the sidebar."
        action={<Button render={<Link to="/dashboard" />}>Go to Dashboard</Button>}
      />
    </>
  )
}
