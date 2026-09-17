import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * `/prospects` is the declared compatibility URL for `/leads` — one CRM
 * implementation, one address (architecture §10). Today it lands on the
 * labelled placeholder; when the pipeline ships the same redirect keeps old
 * links working without a second surface.
 */
export const Route = createFileRoute("/_dashboard/prospects")({
  beforeLoad: () => {
    throw redirect({ to: "/leads" })
  },
})
