import { ChartLineData01Icon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"
import {
  drawnSeries,
  type ActivitySeries,
} from "@/components/dashboard/activity-chart-model"
import { ActivityChartPlot } from "@/components/dashboard/ActivityChartPlot"
import { EmptyState } from "@/components/states/states"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function ActivityChart({
  series,
  hint,
}: {
  series: ActivitySeries | undefined
  hint: string
}) {
  if (series === undefined) {
    return (
      <ChartFrame hint={hint}>
        <Skeleton className="h-56 w-full rounded-2xl bg-foreground/10" />
      </ChartFrame>
    )
  }

  const drawn = drawnSeries(series.days)
  if (drawn.length === 0) {
    return (
      <ChartFrame hint={hint}>
        <EmptyState
          variant="plain"
          icon={ChartLineData01Icon}
          title="Nothing happened in this window"
          description="Leads found, emails accepted and replies received each get a line here, one point per day. Widen the range, or give your agent time for its next run."
        />
      </ChartFrame>
    )
  }

  return (
    <ChartFrame
      hint={hint}
      legend={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {drawn.map((entry) => (
            <span
              key={entry.key}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", entry.dot)}
              />
              {entry.label}
            </span>
          ))}
        </div>
      }
    >
      <ActivityChartPlot
        days={series.days}
        drawn={drawn}
        description={`Daily ${drawn.map((entry) => entry.label.toLowerCase()).join(", ")}, ${hint.toLowerCase()}`}
      />
      {series.truncated ? (
        <p className="text-xs text-muted-foreground">
          This window holds more rows than one read may count ({series.bound}{" "}
          per kind), so the earliest days here are a floor rather than a total.
        </p>
      ) : null}
    </ChartFrame>
  )
}

function ChartFrame({
  hint,
  legend,
  children,
}: {
  hint: string
  legend?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-base font-semibold text-foreground">
            Activity overview
          </h2>
          <p className="text-sm text-muted-foreground">
            What your agent did each day · {hint}
          </p>
        </div>
        {legend}
      </div>
      {children}
    </section>
  )
}
