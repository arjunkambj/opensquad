/**
 * The stat row of reference 20, over the window the range pills chose.
 *
 * Each figure names the rows behind it in its own line, because the acceptance
 * for this screen is that its numbers reconcile with Contacts and Inbox for
 * the same window. A figure that hit its read bound renders as "200+" through
 * `boundedCount` rather than as a silently truncated total.
 *
 * Presentational: the container owns the query and the deal-size mutation.
 */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { DealSizeEditor } from "@/components/dashboard/DealSizeEditor"
import { StatCard } from "@/components/kit/StatCard"
import { boundedCount } from "@/lib/bounded-count"

export type DashboardSummary = FunctionReturnType<
  typeof api.dashboard.queries.summary
>

/**
 * No currency symbol, deliberately: `agents.dealSize` is a bare number and
 * the org never told us which currency it is in. Printing one would be
 * the screen inventing a fact about the user's business.
 */
const amountFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})

export function DashboardStats({
  summary,
  hint,
  canEditDealSize,
  onSaveDealSize,
}: {
  /** `undefined` while the query is still counting. */
  summary: DashboardSummary | undefined
  /** The window in words, e.g. "Last 30 days". */
  hint: string
  canEditDealSize: boolean
  onSaveDealSize: (dealSize: number) => Promise<void>
}) {
  const loading = summary === undefined
  const count = (figure: { count: number; hasMore: boolean } | undefined) =>
    figure === undefined ? "" : boundedCount(figure.count, figure.hasMore)

  return (
    <>
      <StatCard
        label="Hot leads"
        loading={loading}
        value={count(summary?.hotLeads)}
        sublabel="Researched and scored 3 of 3"
        hint={hint}
      />
      <StatCard
        label="Contacted"
        loading={loading}
        value={count(summary?.contacted)}
        sublabel={
          summary === undefined
            ? undefined
            : `${boundedCount(summary.emailsSent.count, summary.emailsSent.hasMore)} email${summary.emailsSent.count === 1 ? "" : "s"} accepted for delivery`
        }
        hint={hint}
      />
      <StatCard
        label="Conversations"
        loading={loading}
        value={count(summary?.conversations)}
        sublabel="Threads someone replied in"
        hint={hint}
      />
      <StatCard
        label="Meetings"
        loading={loading}
        value={count(summary?.meetings)}
        sublabel={
          summary === undefined
            ? undefined
            : summary.meetingsProposed.count === 0
              ? "Confirmed by you"
              : `Confirmed by you · ${boundedCount(summary.meetingsProposed.count, summary.meetingsProposed.hasMore)} proposed`
        }
        hint={hint}
      />
      <StatCard
        label="Pipeline"
        loading={loading}
        value={
          summary === undefined || summary.pipeline === null ? (
            <span className="text-base font-medium text-muted-foreground">
              Set deal size
            </span>
          ) : (
            `${summary.pipeline.atLeast ? "≥ " : ""}${amountFormatter.format(summary.pipeline.amount)}`
          )
        }
        sublabel={
          summary === undefined
            ? undefined
            : summary.dealSize === null
              ? "Tell us what a deal is worth to see this"
              : `${amountFormatter.format(summary.dealSize)} × ${summary.interested.count + summary.meetings.count} interested and booked`
        }
        hint={hint}
        action={
          summary === undefined ? undefined : (
            <DealSizeEditor
              dealSize={summary.dealSize}
              disabled={!canEditDealSize}
              onSave={onSaveDealSize}
            />
          )
        }
      />
    </>
  )
}
