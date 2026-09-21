import { createFileRoute } from "@tanstack/react-router"
import { IntegrationsPage } from "@/components/integrations/IntegrationsPage"

export const Route = createFileRoute("/_dashboard/_org/integrations")({
  component: IntegrationsPage,
})
