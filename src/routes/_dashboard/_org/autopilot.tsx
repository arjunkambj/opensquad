import { createFileRoute } from "@tanstack/react-router"
import { AgentPage } from "@/components/agent/AgentPage"

export const Route = createFileRoute("/_dashboard/_org/autopilot")({
  component: AgentPage,
})
