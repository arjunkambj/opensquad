import {
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartScale,
  dayLabel,
  type ActivityDay,
  type SeriesSpec,
} from "@/components/dashboard/activity-chart-model"
import { useEffect, useRef, useState } from "react"
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
  // Draw at the real width so text and strokes stay their true size and the
  // height stays fixed, instead of the whole picture scaling with the card.
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(CHART_WIDTH)
  useEffect(() => {
    const node = frame.current
    if (node === null) {
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) {
        setWidth(Math.round(entry.contentRect.width))
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const scale = chartScale(days, drawn, width)
  const baseline = scale.y(0)

  return (
    <div ref={frame} className="w-full">
    <svg
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      className="block"
      role="img"
      aria-label={description}
    >
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={CHART_PADDING.left}
            x2={width - CHART_PADDING.right}
            y1={scale.y(tick)}
            y2={scale.y(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={CHART_PADDING.left - 8}
            y={scale.y(tick) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-2xs"
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
            className="fill-muted-foreground text-2xs"
          >
            {dayLabel(day.dayKey)}
          </text>
        ) : null,
      )}
    </svg>
    </div>
  )
}
