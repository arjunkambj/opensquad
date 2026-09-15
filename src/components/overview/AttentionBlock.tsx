import { Link } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { boundedCount } from "@/lib/bounded-count"

/**
 * One page of open decisions, and exactly one arg shape.
 *
 * The sidebar badge and this block must read the **same call**: two numbers
 * for one thing is a defect (`plan/ux.md` §3), and Convex serves one
 * subscription only when the arguments match byte for byte. That is why this
 * is a hook rather than two call sites agreeing to use the same literal.
 *
 * It counts **open decisions of every kind, required or not**. `listOpen`
 * filters on state only and has no `required` argument, and filtering a
 * truncated page client-side would present a subset of one page as a filtered
 * total — which `plan/ux.md` §6 forbids. So the number is labelled for what it
 * actually is.
 */
export function useOpenDecisionCount(
  workspaceId: Id<"workspaces"> | undefined,
): string | undefined {
  const page = useQuery(
    api.decisions.listOpen,
    workspaceId === undefined ? "skip" : { workspaceId, limit: 25 },
  )
  return page === undefined
    ? undefined
    : boundedCount(page.items.length, page.hasMore)
}

/**
 * What is waiting on a person, in three counts.
 *
 * It owns its own queries and takes only a workspace id, so P13 can drop it
 * onto `/leads` unchanged.
 *
 * Two of the three slots have no backing query at all and say so. That
 * distinction is the whole point of the shape: a `0` means *we asked, and
 * nothing is waiting*; "not available yet" means *we cannot ask*. Rendering a
 * `0` for the second would be a fabricated number, and fabricating a number is
 * the failure this product can least afford.
 *
 * - **Unassigned mail** — there is no `convex/conversations.ts` at all, and
 *   `activityEvents`, `decisions` and `missionComments` all require a
 *   `missionId`, so an unassigned conversation cannot even appear in
 *   `decisions.listOpen`. It gets its own bounded count when the shared inbox
 *   ships.
 * - **Overdue next actions** — `nextActionDueAt` lives on `prospects` and
 *   there is no `convex/prospects.ts` yet.
 */
export function AttentionBlock({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">
}) {
  const decisions = useOpenDecisionCount(workspaceId)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardDescription>Open decisions</CardDescription>
          <CardTitle
            className="font-heading text-3xl tabular-nums"
            aria-live="polite"
          >
            {decisions ?? "—"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted-foreground">
            {decisions === undefined
              ? "Counting what is waiting on a human."
              : decisions === "0"
                ? "Nothing is waiting on you."
                : "Asks of every kind, required or not, waiting on a human."}
          </p>
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/decisions" />}
          >
            Go to Decisions
          </Button>
        </CardContent>
      </Card>

      <UnavailableCount
        label="Unassigned mail"
        reason="Unassigned and taken-over threads get their count when the shared inbox ships. Nothing is being hidden — there is no query to ask yet."
      />

      <UnavailableCount
        label="Overdue next actions"
        reason="A lead's next action lives on the CRM record, and no query reads it yet. A zero here would be invented, so there is none."
      />
    </div>
  )
}

/**
 * A slot with no number, deliberately. It is a card rather than a hidden
 * element so the operator can see that the product knows about this count and
 * has not silently dropped it.
 */
function UnavailableCount({
  label,
  reason,
}: {
  label: string
  reason: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-heading text-lg text-muted-foreground">
          Not available yet
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{reason}</p>
      </CardContent>
    </Card>
  )
}
