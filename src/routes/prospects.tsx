import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * One list of people, one address (PLAN §5): `/prospects` is the pre-pivot
 * name and `prospects` is still the backend table, but the product word is
 * Contacts. The redirect keeps old links and bookmarks working without a
 * second surface.
 */
export const Route = createFileRoute("/prospects")({
  beforeLoad: () => {
    throw redirect({ to: "/contacts" })
  },
})
