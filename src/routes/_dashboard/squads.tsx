import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * `/squads` predates the Employees surface — keep it as a typed redirect so
 * old links land on the real employee view (architecture §10).
 */
export const Route = createFileRoute("/_dashboard/squads")({
  beforeLoad: () => {
    throw redirect({ to: "/employees" })
  },
})
