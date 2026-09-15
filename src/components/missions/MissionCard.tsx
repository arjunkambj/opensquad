import { Link } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import type { Doc } from "../../../convex/_generated/dataModel"
import { formatWaited } from "@/components/decisions/decision-presentation"
import { useMissionFocus } from "@/components/missions/mission-focus"
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
  viewKey,
  ownerName,
  ownersLoading,
}: {
  mission: Doc<"missions">
  /**
   * The board view this card is rendered in — its filters, its column and its
   * page. Focus restore is scoped to it, so a remounted card in some later
   * view cannot claim a memory taken from an earlier one.
   */
  viewKey: string
  ownerName: string | undefined
  ownersLoading: boolean
}) {
  const { remember, claim } = useMissionFocus()
  const ref = useRef<HTMLAnchorElement>(null)

  // Closing the detail returns focus to the row that opened it. The claim is
  // made by the card itself rather than by the board, because a column's rows
  // arrive asynchronously — the board has no moment at which it can be sure
  // the remembered card is on screen, and this card knows exactly when it is.
  //
  // `viewKey` is what stops that latitude becoming a licence. This effect runs
  // on every mount of a matching card, and a board under `/overview` remounts
  // its cards whenever the operator changes a filter or a column; without the
  // view in the key, pressing a column selector could mount the remembered
  // card and pull focus out of the control just pressed.
  useEffect(() => {
    if (claim(mission._id, viewKey)) {
      ref.current?.focus()
    }
  }, [claim, mission._id, viewKey])

  return (
    <Link
      ref={ref}
      to="/overview/missions/$missionId"
      params={{ missionId: mission._id }}
      search={(previous) => previous}
      onClick={() => remember(mission._id, viewKey)}
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
