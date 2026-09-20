import { createFileRoute, redirect } from "@tanstack/react-router"

/** Pre-pivot `/overview` — the page is `/dashboard` now (PLAN §5). */
export const Route = createFileRoute("/overview")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" })
  },
})
