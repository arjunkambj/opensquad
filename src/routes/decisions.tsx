import { createFileRoute, redirect } from "@tanstack/react-router"

/**
 * Pre-pivot `/decisions` — approvals and replies are worked in the thread
 * they belong to now, so the nearest page is the Inbox (PLAN §5).
 */
export const Route = createFileRoute("/decisions")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" })
  },
})
