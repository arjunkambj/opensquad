import { createFileRoute, useParams } from "@tanstack/react-router"
import { MissionDetail } from "@/components/missions/MissionDetail"

export const Route = createFileRoute(
  "/_dashboard/_workspace/overview/missions/$missionId",
)({
  component: MissionDetailPage,
})

/**
 * One mission, at its own URL, nested under the board.
 *
 * Nesting is the point: the board's `?campaign`, `?column` and `?archived` are
 * still in the URL while this is open, so closing the detail cannot lose them
 * — there is no filter state that *can* be lost. V09 step 1 copies this URL,
 * reloads it and opens it in a second session; step 2 closes it and expects
 * the board context back.
 *
 * No error boundary and no `notFoundComponent` here: `_dashboard` already maps
 * NOT_FOUND — which `missions.get` throws for a foreign or cross-workspace id
 * — to an in-shell empty state, and a local boundary would replace the shell
 * and strand the operator.
 */
function MissionDetailPage() {
  const { missionId } = useParams({
    from: "/_dashboard/_workspace/overview/missions/$missionId",
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Keyed on the id so every per-mission ref — most importantly the
          version the operator actually saw — is fresh when the route param
          changes without unmounting the component. */}
      <MissionDetail key={missionId} missionId={missionId} />
    </div>
  )
}
