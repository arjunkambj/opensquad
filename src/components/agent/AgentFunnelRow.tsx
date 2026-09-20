/**
 * The agent card's funnel figures (reference 21): Contacted n / total,
 * Replied, Interested.
 *
 * There is no "Opened" column. PLAN §9.6 admits the metric only once open
 * events are verified for the workspace, and this build never verifies one —
 * so it is absent entirely rather than rendered as a zero or a dash.
 *
 * Presentational: the counts arrive derived, and a still-loading read is a
 * state of its own so a figure being counted cannot read as a counted zero.
 */
import { Skeleton } from "@/components/ui/skeleton"
import { boundedCount } from "@/lib/bounded-count"
import type { AgentFunnel } from "./agent-model"
import { ratePercent } from "./agent-model"

function Figure({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-display text-2xl leading-none font-semibold text-foreground tabular-nums">
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export function AgentFunnelRow({ funnel }: { funnel: AgentFunnel | undefined }) {
  if (funnel === undefined) {
    return (
      <div className="flex flex-wrap gap-8">
        {["Contacted", "Replied", "Interested"].map((label) => (
          <div key={label} className="flex min-w-24 flex-col gap-1">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {label}
            </p>
            <Skeleton className="h-6 w-16 rounded-lg bg-foreground/10" />
          </div>
        ))}
      </div>
    )
  }

  const bounded = (value: number) => boundedCount(value, funnel.bounded)
  const contactedShare = ratePercent(funnel.contacted, funnel.total)
  const replyShare = ratePercent(funnel.replied, funnel.contacted)
  const interestShare = ratePercent(funnel.interested, funnel.replied)

  return (
    <div className="flex flex-wrap gap-8">
      <Figure
        label="Contacted"
        value={`${bounded(funnel.contacted)} / ${bounded(funnel.total)}`}
        hint={
          contactedShare === null
            ? "No leads yet"
            : `${contactedShare}% of leads found`
        }
      />
      <Figure
        label="Replied"
        value={bounded(funnel.replied)}
        // A rate over nobody is unknown, not zero.
        hint={replyShare === null ? "— reply rate" : `${replyShare}% reply rate`}
      />
      <Figure
        label="Interested"
        value={bounded(funnel.interested)}
        hint={
          interestShare === null
            ? "— of replies"
            : `${interestShare}% of replies`
        }
      />
    </div>
  )
}
