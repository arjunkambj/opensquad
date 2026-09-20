import { createFileRoute, redirect } from "@tanstack/react-router"

/** Pre-pivot `/squads` — one agent per workspace now, on `/agent`. */
export const Route = createFileRoute("/squads")({
  beforeLoad: () => {
    throw redirect({ to: "/agent" })
  },
})
