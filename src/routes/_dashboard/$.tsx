import { createFileRoute } from "@tanstack/react-router"
import { DashboardNotFound } from "@/components/layout/DashboardNotFound"

export const Route = createFileRoute("/_dashboard/$")({
  component: DashboardNotFound,
})
