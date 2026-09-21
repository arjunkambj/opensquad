import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"

export type ActivitySeries = FunctionReturnType<
  typeof api.dashboard.queries.activitySeries
>

export type ActivityDay = ActivitySeries["days"][number]

type SeriesKey = "leadsCreated" | "contacted" | "replies"

export type SeriesSpec = {
  key: SeriesKey
  label: string
  line: string
  dot: string
  area: string
}

const ACTIVITY_SERIES: readonly SeriesSpec[] = [
  {
    key: "leadsCreated",
    label: "Leads created",
    line: "stroke-chart-1",
    dot: "bg-chart-1",
    area: "fill-chart-1/10",
  },
  {
    key: "contacted",
    label: "Contacted",
    line: "stroke-chart-2",
    dot: "bg-chart-2",
    area: "fill-chart-2/10",
  },
  {
    key: "replies",
    label: "Replies",
    line: "stroke-chart-4",
    dot: "bg-chart-4",
    area: "fill-chart-4/10",
  },
]

export function drawnSeries(days: readonly ActivityDay[]): SeriesSpec[] {
  return ACTIVITY_SERIES.filter((series) =>
    days.some((day) => day[series.key] > 0),
  )
}

export const CHART_WIDTH = 720
export const CHART_HEIGHT = 220
export const CHART_PADDING = { top: 12, right: 12, bottom: 28, left: 34 }
const PLOT_HEIGHT =
  CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

const MAX_AXIS_LABELS = 12

export type ChartScale = {
  x: (index: number) => number
  y: (value: number) => number
  ticks: number[]
  labelEvery: number
}

export function chartScale(
  days: readonly ActivityDay[],
  drawn: readonly SeriesSpec[],
  /** The drawn width in pixels; the height stays fixed. */
  width: number = CHART_WIDTH,
): ChartScale {
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right
  const max = Math.max(
    1,
    ...days.flatMap((day) => drawn.map((series) => day[series.key])),
  )
  const step = days.length > 1 ? plotWidth / (days.length - 1) : 0
  const middle = Math.round(max / 2)
  return {
    x: (index) =>
      days.length > 1
        ? CHART_PADDING.left + index * step
        : CHART_PADDING.left + plotWidth / 2,
    y: (value) =>
      CHART_PADDING.top + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT,
    ticks: middle > 0 && middle < max ? [0, middle, max] : [0, max],
    labelEvery: Math.max(1, Math.ceil(days.length / MAX_AXIS_LABELS)),
  }
}

const dayLabelFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

/** Read the civil YYYY-MM-DD key as UTC; browser-local parsing would shift labels across timezones. */
export function dayLabel(dayKey: string): string {
  const at = Date.parse(`${dayKey}T00:00:00Z`)
  return Number.isNaN(at) ? dayKey : dayLabelFormatter.format(new Date(at))
}
