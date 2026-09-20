import { useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import { EmptyState, LoadingState } from "@/components/states/states"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Usage — the credit balance, in our own unit (PLAN §6 layer 1).
 *
 * Neutral by construction: the query returns granted / remaining / pending
 * and nothing else, so no provider name, provider unit or hidden cap can
 * reach this screen. The per-action history comes from the real ledger in
 * T43; this shows the balance the same block in the sidebar shows, from the
 * same query.
 */
export function UsageSection({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">
}) {
  const balance = useQuery(api.billing.credits.balance, { workspaceId })

  if (balance === undefined) {
    return (
      <LoadingState
        title="Loading usage"
        description="Reading this workspace's credit balance."
      />
    )
  }

  // `null` is not zero: the workspace holds no grant at all, so every paid
  // step refuses for a different reason than an exhausted balance.
  if (balance === null) {
    return (
      <EmptyState
        title="No credits granted"
        description="This workspace has no credit grant yet, so paid steps — finding emails, research, writing email — will refuse. Finishing setup creates the trial grant."
      />
    )
  }

  const used = Math.max(0, balance.granted - balance.remaining - balance.pending)

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Credits</CardTitle>
        <CardDescription>
          One trial grant, no refill and no upgrade. Free work — browsing,
          approving, sending, handling unsubscribes — never touches it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Figure label="Remaining" value={balance.remaining} />
        <Figure label="Spent" value={used} />
        <Figure
          label="Held"
          value={balance.pending}
          note="Work in progress, released or billed when it settles."
        />
      </CardContent>
    </Card>
  )
}

function Figure({
  label,
  value,
  note,
}: {
  label: string
  value: number
  note?: string
}) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <p className="text-xs tracking-eyebrow text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-display text-foreground">
        {value}
      </p>
      {note ? (
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      ) : null}
    </div>
  )
}
