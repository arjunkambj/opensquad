import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * `/tour` is listed as public in PLAN §5, but its content was removed with
 * the rest of the pre-pivot mock data and nothing honest has replaced it yet.
 * A page that says nothing is worse than no page, so it lands on the home
 * page until T50 writes the real landing copy and gives it a body.
 */
export const Route = createFileRoute("/tour")({
  beforeLoad: () => {
    throw redirect({ to: "/" })
  },
})
