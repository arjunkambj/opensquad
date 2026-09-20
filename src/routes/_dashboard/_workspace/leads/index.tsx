import { createFileRoute } from "@tanstack/react-router"
import { LeadsPage } from "@/components/contacts/LeadsPage"

export const Route = createFileRoute("/_dashboard/_workspace/leads/")({
  component: LeadsPage,
})
