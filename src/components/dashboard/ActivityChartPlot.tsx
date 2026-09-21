import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  dayLabel,
  type ActivityDay,
  type SeriesSpec,
} from "@/components/dashboard/activity-chart-model"
import { cn } from "@/lib/utils"

export function ActivityChartPlot({
  days,
  drawn,
  description,
}: {
  days: readonly ActivityDay[]
  drawn: readonly SeriesSpec[]
  description: string
}) {
  const scale = chartScale(days, drawn)
  const baseline = scale.y(0)

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label={description}
    >
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={CHART_PADDING.left}
            x2={CHART_WIDTH - CHART_PADDING.right}
            y1={scale.y(tick)}
            y2={scale.y(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={CHART_PADDING.left - 8}
            y={scale.y(tick) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[9px]"
          >
            {tick}
          </text>
        </g>
      ))}

      {drawn.map((series) => {
        const points = days.map(
          (day, index) => `${scale.x(index)},${scale.y(day[series.key])}`,
        )
        return (
          <g key={series.key}>
            {days.length > 1 ? (
              <polygon
                className={series.area}
                points={`${scale.x(0)},${baseline} ${points.join(" ")} ${scale.x(days.length - 1)},${baseline}`}
              />
            ) : null}
            <polyline
              className={series.line}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points.join(" ")}
            />
            {days.map((day, index) =>
              day[series.key] > 0 ? (
                <circle
                  key={day.dayKey}
                  cx={scale.x(index)}
                  cy={scale.y(day[series.key])}
                  r={2.5}
                  strokeWidth={2}
                  className={cn(series.line, "fill-card")}
                >
                  <title>{`${dayLabel(day.dayKey)} · ${day[series.key]} ${series.label.toLowerCase()}`}</title>
                </circle>
              ) : null,
            )}
          </g>
        )
      })}

      {days.map((day, index) =>
        index % scale.labelEvery === 0 ? (
          <text
            key={day.dayKey}
            x={scale.x(index)}
            y={CHART_HEIGHT - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {dayLabel(day.dayKey)}
          </text>
        ) : null,
      )}
    </svg>
  )
}
