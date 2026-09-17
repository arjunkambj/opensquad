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
  // Keyed on the id so every per-lead ref — the seen-version pin, form epoch
  // and minted intent ids — is fresh when the route param changes without
  // unmounting the component (the same reason decisions key on decisionId).
  return <LeadDetail key={prospectId} prospectId={prospectId} />
}
