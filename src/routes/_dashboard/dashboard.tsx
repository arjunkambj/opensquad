import { createFileRoute, redirect } from "@tanstack/react-router"

/** Old bookmarks: the dashboard is now the overview. */
export const Route = createFileRoute("/_dashboard/dashboard")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/overview", search, replace: true })
  },
})
