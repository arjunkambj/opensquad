import { useState } from "react"
import { DashboardPageTitle } from "@/components/Layout/DashboardPageTitle"
import { OverviewDateRangePicker } from "@/components/overview/OverviewDateRangePicker"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type CalendarDateRange,
  type DateRangePreset,
  getPresetRange,
} from "@/lib/date-ranges"

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

export function OverviewDashboard() {
  const [range, setRange] = useState(() => getPresetRange("today"))
  const [preset, setPreset] = useState<DateRangePreset | null>("today")

  const updateRange = (
    nextRange: CalendarDateRange,
    nextPreset: DateRangePreset | null,
  ) => {
    setRange(nextRange)
    setPreset(nextPreset)
  }

  const rangeLabel =
    range.start.getTime() === range.end.getTime()
      ? dateFormatter.format(range.start)
      : `${dateFormatter.format(range.start)} – ${dateFormatter.format(range.end)}`

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageTitle
        title="Overview"
        description="Your squad workspace at a glance."
        actions={
          <OverviewDateRangePicker
            value={range}
            preset={preset}
            onChange={updateRange}
          />
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Showing {rangeLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No activity in this range yet.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
