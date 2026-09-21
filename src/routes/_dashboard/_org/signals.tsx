import { createFileRoute } from "@tanstack/react-router"
import { SignalsPage } from "@/components/agent/SignalsPage"

export const Route = createFileRoute("/_dashboard/_org/signals")({
  component: SignalsPage,
})
