import { createFileRoute, redirect } from "@tanstack/react-router"

/** Pre-pivot `/leads` — the page is `/contacts` now (PLAN §5). */
export const Route = createFileRoute("/leads")({
  beforeLoad: () => {
    throw redirect({ to: "/contacts" })
  },
})
