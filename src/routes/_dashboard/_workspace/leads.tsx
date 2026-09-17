import { Link, createFileRoute } from "@tanstack/react-router"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { EmptyState } from "@/components/states/states"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_dashboard/_workspace/leads")({
  component: LeadsPlaceholder,
})

/**
 * `/leads` is the declared signed-in CRM home (architecture §10) — but the
 * pipeline APIs it is built on land with P19. This page exists so the sidebar
 * entry introduced alongside `/inbox` leads somewhere honest: it says what is
 * coming and routes the operator to the view that works today. It is a
 * placeholder, deliberately — a fake pipeline would be worse than a labelled
 * gap.
 */
function LeadsPlaceholder() {
  return (
    <>
      <DashboardPageTitle
        title="Leads"
        description="The CRM home — pipeline stages, owners, next actions and per-lead history."
      />
      <EmptyState
        title="Coming with the CRM surface"
        description="The leads pipeline ships when the CRM APIs land (P19). Until then this URL is a labelled placeholder, not a broken link — Mission Control and the Inbox already show the work the squad is doing on your prospects."
        action={
          <Button
            variant="outline"
            render={<Link to="/overview" />}
          >
            Go to Mission Control
          </Button>
        }
      />
    </>
  )
}
