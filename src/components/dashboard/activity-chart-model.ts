/**
 * The geometry and vocabulary behind the activity chart.
 *
 * Separated from the drawing so the component stays a component: this file
 * holds the series list, the plot box and the two scales, and knows nothing
 * about React.
 *
 * Every colour is a `--chart-*` token from the global stylesheet, named as the
 * Tailwind class that applies it. Nothing here carries a literal colour.
 */
import type { FunctionReturnType } from "convex/server"
import type { api } from "../../../convex/_generated/api"

export type ActivitySeries = FunctionReturnType<
  typeof api.dashboard.queries.activitySeries
>

export type ActivityDay = ActivitySeries["days"][number]

export type SeriesKey = "leadsCreated" | "contacted" | "replies"

export type SeriesSpec = {
  key: SeriesKey
  label: string
  /** Tailwind classes over the global chart tokens. */
  line: string
  dot: string
  area: string
}

/**
 * The three series, in legend order. A series is drawn only when its rows
 * exist (see `drawnSeries`): before the first send, "Contacted" and "Replies"
 * would be flat lines along the axis, which reads as a measured zero rather
 * than as work that has not started.
 */
export const ACTIVITY_SERIES: readonly SeriesSpec[] = [
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

/** The series that have at least one non-zero day in this window. */
export function drawnSeries(days: readonly ActivityDay[]): SeriesSpec[] {
  return ACTIVITY_SERIES.filter((series) =>
    days.some((day) => day[series.key] > 0),
  )
}

/* The drawing box, in fixed user units scaled to the card's width by the
   viewBox. Plain arithmetic below, and labels that scale with the line
   instead of stretching away from it. */
export const CHART_WIDTH = 720
export const CHART_HEIGHT = 220
export const CHART_PADDING = { top: 12, right: 12, bottom: 28, left: 34 }
export const PLOT_WIDTH = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right
export const PLOT_HEIGHT =
  CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom

/** At most this many date labels, so a ninety-day window stays legible. */
const MAX_AXIS_LABELS = 12

export type ChartScale = {
  x: (index: number) => number
  y: (value: number) => number
  ticks: number[]
  /** Label every nth day. */
  labelEvery: number
}

export function chartScale(
  days: readonly ActivityDay[],
  drawn: readonly SeriesSpec[],
): ChartScale {
  const max = Math.max(
    1,
    ...days.flatMap((day) => drawn.map((series) => day[series.key])),
  )
  const step = days.length > 1 ? PLOT_WIDTH / (days.length - 1) : 0
  const middle = Math.round(max / 2)
  return {
    x: (index) =>
      days.length > 1
        ? CHART_PADDING.left + index * step
        : CHART_PADDING.left + PLOT_WIDTH / 2,
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

/**
 * `YYYY-MM-DD` as "Sep 18". Read back as UTC on purpose: the key is a civil
 * date the server already cut in the WORKSPACE's zone, so running it through
 * the browser's zone would shift half the labels by a day.
 */
export function dayLabel(dayKey: string): string {
  const at = Date.parse(`${dayKey}T00:00:00Z`)
  return Number.isNaN(at) ? dayKey : dayLabelFormatter.format(new Date(at))
}
