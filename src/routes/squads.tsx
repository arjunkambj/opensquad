import { createFileRoute, redirect } from "@tanstack/react-router"

/** Pre-pivot `/squads` — one agent per org now, on `/agent`. */
export const Route = createFileRoute("/squads")({
  beforeLoad: () => {
    throw redirect({ to: "/agent" })
  },
})
