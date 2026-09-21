import { createFileRoute, redirect } from "@tanstack/react-router"

/** The old single agent page was split into Signals and Autopilot; keep old links working. */
export const Route = createFileRoute("/_dashboard/_org/agent")({
  beforeLoad: () => {
    throw redirect({ to: "/autopilot", replace: true })
  },
})
