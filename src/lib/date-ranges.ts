import {
  endOfMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns"

export const DATE_RANGE_PRESETS = {
  today: { label: "Today" },
  yesterday: { label: "Yesterday" },
  last_7_days: { label: "Last 7 days" },
  last_30_days: { label: "Last 30 days" },
  week_to_date: { label: "Week to date" },
  month_to_date: { label: "Month to date" },
  last_month: { label: "Last month" },
} as const

export type DateRangePreset = keyof typeof DATE_RANGE_PRESETS

export type CalendarDateRange = {
  start: Date
  end: Date
}

export function getPresetRange(
  preset: DateRangePreset,
  now = new Date(),
): CalendarDateRange {
  const currentDate = startOfDay(now)

  switch (preset) {
    case "today":
      return { start: currentDate, end: currentDate }
    case "yesterday": {
      const yesterday = subDays(currentDate, 1)
      return { start: yesterday, end: yesterday }
    }
    case "last_7_days":
      return { start: subDays(currentDate, 6), end: currentDate }
    case "last_30_days":
      return { start: subDays(currentDate, 29), end: currentDate }
    case "week_to_date":
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: currentDate,
      }
    case "month_to_date":
      return { start: startOfMonth(currentDate), end: currentDate }
    case "last_month": {
      const previousMonth = subMonths(currentDate, 1)
      return {
        start: startOfMonth(previousMonth),
        end: startOfDay(endOfMonth(previousMonth)),
      }
    }
  }
}
