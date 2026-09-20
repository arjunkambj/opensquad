import { createFileRoute } from "@tanstack/react-router"
import { AgentPage } from "@/components/agent/AgentPage"

/**
 * The one agent a workspace runs. No search contract: the page has a single
 * view, and its sub-sections (signals, instructions, runs) are T32's, which
 * will add params here if any of them turns out to be linkable.
 */
export const Route = createFileRoute("/_dashboard/_workspace/agent")({
  component: AgentPage,
})
