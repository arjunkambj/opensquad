import {
  Calendar03Icon,
  ChartIncreaseIcon,
  InboxIcon,
  MailSend01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons"
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"
import { DealSizeEditor } from "@/components/dashboard/DealSizeEditor"
import { StatCard } from "@/components/kit/StatCard"
import { boundedCount } from "@/lib/bounded-count"

export type DashboardSummary = FunctionReturnType<
  typeof api.dashboard.queries.summary
>

/** No currency symbol: dealSize has no stored currency. */
const amountFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/** The four headline counts, one row. */
export function DashboardStats({
  summary,
  hint,
}: {
  summary: DashboardSummary | undefined
  hint: string
}) {
  const loading = summary === undefined
  const count = (figure: { count: number; hasMore: boolean } | undefined) =>
    figure === undefined ? "" : boundedCount(figure.count, figure.hasMore)

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Hot leads"
        icon={StarIcon}
        loading={loading}
        value={count(summary?.hotLeads)}
        sublabel="Researched and scored 3 of 3"
        hint={hint}
      />
      <StatCard
        label="Contacted"
        icon={MailSend01Icon}
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
        icon={InboxIcon}
        loading={loading}
        value={count(summary?.conversations)}
        sublabel="Threads someone replied in"
        hint={hint}
      />
      <StatCard
        label="Meetings"
        icon={Calendar03Icon}
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
    </div>
  )
}

export function PipelineStat({
  summary,
  hint,
  canEditDealSize,
  onSaveDealSize,
  className,
}: {
  summary: DashboardSummary | undefined
  hint: string
  canEditDealSize: boolean
  onSaveDealSize: (dealSize: number) => Promise<void>
  className?: string
}) {
  const loading = summary === undefined
  return (
    <StatCard
        className={className}
        label="Pipeline"
        icon={ChartIncreaseIcon}
        loading={loading}
        value={
          summary === undefined || summary.pipeline === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            `${summary.pipeline.atLeast ? "≥ " : ""}${amountFormatter.format(summary.pipeline.amount)}`
          )
        }
        sublabel={
          summary === undefined
            ? undefined
            : summary.dealSize === null
              ? "Set a deal size to see this"
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
  )
}
