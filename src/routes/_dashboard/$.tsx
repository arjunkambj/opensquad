import { Link, createFileRoute, useParams } from "@tanstack/react-router"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"

/**
 * In-shell not-found. `_dashboard` is a pathless layout, so this splat matches
 * any unrouted path and — because a splat has the lowest match priority — only
 * after every real route has declined it.
 *
 * It exists so a mistyped or not-yet-built URL keeps the sidebar. The root's
 * `notFoundComponent` renders outside the shell and strands the user with no
 * navigation, which is the wrong answer for a path inside the app: the routes
 * architecture §10 promises (`/leads`, `/inbox`, `/decisions`) are typed into
 * the address bar by people who already work here.
 */
export const Route = createFileRoute("/_dashboard/$")({
  component: DashboardNotFound,
})

function DashboardNotFound() {
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
        action={<Button render={<Link to="/overview" />}>Go to Overview</Button>}
      />
    </>
  )
}
