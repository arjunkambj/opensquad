import { Link, useParams } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/layout/DashboardPageTitle"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

/**
 * In-shell not-found: a mistyped or not-yet-built URL keeps the sidebar.
 *
 * The root's `notFoundComponent` renders outside the shell and strands the
 * user with no navigation, which is the wrong answer for a path inside the
 * app: the routes architecture §10 promises (`/leads`, `/inbox`, `/overview`)
 * are typed into the address bar by people who already work here.
 */
export function DashboardNotFound() {
  const { _splat } = useParams({ from: "/_dashboard/$" })
  const attempted = _splat === undefined ? undefined : `/${_splat}`

  return (
    <>
      <DashboardPageTitle
        title="Page not found"
        description="That address does not match a page in this workspace."
      />
      <EmptyState
        title={attempted ?? "Page not found"}
        description="Check the address, or pick a page from the sidebar. Some parts of OpenSquad are still being built."
        action={<Button render={<Link to="/leads" />}>Go to Leads</Button>}
      />
    </>
  )
}
