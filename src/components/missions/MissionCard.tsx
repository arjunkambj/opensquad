import { Link } from "@tanstack/react-router"
import type { Doc } from "../../../convex/_generated/dataModel"
import { formatWaited } from "@/components/decisions/decision-presentation"
import {
  MissionOutcomeChip,
  MissionPriorityChip,
  MissionStateChip,
} from "@/components/missions/mission-presentation"

/**
 * One mission on the board.
 *
 * The whole card is a **link**, and it is never draggable. Dragging a card
 * between columns would manufacture a state transition nobody authorised —
 * `booked` without a booking, `contacted` without a send acceptance — and
 * `plan/ux.md` §8 forbids it outright. Every state change goes through a
 * confirmed lifecycle action on the detail route instead, so no mutation is
 * reachable from a card at all.
 *
 * The state chip is mandatory rather than decorative: two of the four columns
 * hold several states, so the column header cannot tell an operator what this
 * card is.
 *
 * Nothing on the card animates. There is no per-mission execution signal —
 * `vRuntimeStatus` does not expose `currentRunId` and `state === "active"` is
 * not one, since a mission can be active with a dead runtime. The board's one
 * liveness surface is the workspace runtime badge.
 */
export function MissionCard({
  mission,
  ownerName,
  ownersLoading,
}: {
  mission: Doc<"missions">
  ownerName: string | undefined
  ownersLoading: boolean
}) {
  return (
    <Link
      to="/overview/missions/$missionId"
      params={{ missionId: mission._id }}
      search={(previous) => previous}
      className="flex flex-col gap-2 rounded-[min(var(--radius-4xl),24px)] bg-card px-4 py-3 text-card-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <p className="text-sm font-medium text-foreground">{mission.title}</p>

      <div className="flex flex-wrap items-center gap-2">
        <MissionStateChip state={mission.state} />
        <MissionPriorityChip priority={mission.priority} />
        {mission.outcome === undefined ? null : (
          <MissionOutcomeChip outcome={mission.outcome.kind} />
        )}
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {mission.progressSummary}
      </p>

      {mission.failure === undefined ? null : (
        <p className="text-sm text-destructive">{mission.failure.message}</p>
      )}

      <p className="text-xs text-muted-foreground">
        {ownersLoading
          ? "loading owner…"
          : (ownerName ?? "owner off the roster")}{" "}
        ·{" "}
        {/* The explicit zero, never a hidden element: "no asks open" is a
            fact the operator needs, and an absent count reads as unknown. */}
        {mission.requiredDecisionCount === 0
          ? "no asks open"
          : `${mission.requiredDecisionCount} ${
              mission.requiredDecisionCount === 1 ? "ask" : "asks"
            } open`}{" "}
        · updated {formatWaited(mission.updatedAt)}
      </p>
    </Link>
  )
}
