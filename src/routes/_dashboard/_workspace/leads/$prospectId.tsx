import { createFileRoute } from "@tanstack/react-router"
import { LeadDetail } from "@/components/leads/LeadDetail"

/**
 * `/leads/$prospectId` — one lead. The search contract lives on the `leads`
 * layout so the tab and every list param share one definition; a foreign or
 * malformed id surfaces through the dashboard boundary (NOT_FOUND, never a
 * fabricated record).
 */
export const Route = createFileRoute("/_dashboard/_workspace/leads/$prospectId")({
  component: LeadDetailPage,
})

function LeadDetailPage() {
  const { prospectId } = Route.useParams()
  return <LeadDetail prospectId={prospectId} />
}
