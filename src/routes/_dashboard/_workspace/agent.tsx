import { createFileRoute } from "@tanstack/react-router"
import { AgentPage } from "@/components/agent/AgentPage"

/**
 * The one agent a workspace runs. No search contract: the page has a single
 * view, every section on it is open at once, and nothing on it is a separate
 * destination — so there is no state worth putting in the URL.
 */
export const Route = createFileRoute("/_dashboard/_workspace/agent")({
  component: AgentPage,
})
