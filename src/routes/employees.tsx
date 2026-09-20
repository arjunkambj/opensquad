import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * Pre-pivot `/employees` — the squad of named workers is one agent now, and
 * everything those pages configured lives on `/agent` (PLAN §5).
 */
export const Route = createFileRoute("/employees")({
  beforeLoad: () => {
    throw redirect({ to: "/agent" })
  },
})
