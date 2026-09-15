import { createFileRoute, useParams } from "@tanstack/react-router"
import { DecisionDetail } from "@/components/decisions/DecisionDetail"

export const Route = createFileRoute(
  "/_dashboard/_workspace/decisions/$decisionId",
)({
  component: DecisionDetailPage,
})

/**
 * One decision, at its own URL — the one deliberate exception to "detail
 * panels are not routes". V13 step 2 opens the same draft in two sessions and
 * attempts approval of a stale revision in one of them, which needs a link
 * someone can paste, not a panel someone has to navigate to.
 *
 * No error boundary here: `_dashboard` already maps NOT_FOUND (a foreign or
 * cross-workspace id) to an in-shell empty state, so a bad id keeps the shell
 * instead of stranding the reviewer.
 */
function DecisionDetailPage() {
  const { decisionId } = useParams({
    from: "/_dashboard/_workspace/decisions/$decisionId",
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Keyed on the id so every per-decision ref — most importantly the
          request-id map and the version the reviewer actually saw — is fresh
          when the route param changes without unmounting the component. */}
      <DecisionDetail key={decisionId} decisionId={decisionId} />
    </div>
  )
}
