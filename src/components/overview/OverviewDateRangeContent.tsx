import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addMonths, isAfter, startOfDay, startOfMonth } from "date-fns"
import { useState } from "react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { DatePicker } from "@/components/ui/date-picker"
import {
  DATE_RANGE_PRESETS,
  type CalendarDateRange,
  type DateRangePreset,
  getPresetRange,
} from "@/lib/date-ranges"

type Props = {
  value: CalendarDateRange
  preset: DateRangePreset | null
  onChange: (range: CalendarDateRange, preset: DateRangePreset | null) => void
  onClose: () => void
}

function startOfMonthDate(date: Date) {
  return startOfMonth(date)
}

function monthFromRangeEnd(range: CalendarDateRange) {
  return startOfMonthDate(addMonths(range.end, -1))
}

function formatMonthRange(start: Date) {
  const end = addMonths(start, 1)
  const startMonth = start.toLocaleString("en", { month: "long" })
  const endMonth = end.toLocaleString("en", { month: "long" })
  if (start.getFullYear() === end.getFullYear()) {
    return `${startMonth} – ${endMonth} ${start.getFullYear()}`
  }
  return `${startMonth} ${start.getFullYear()} – ${endMonth} ${end.getFullYear()}`
}

function rangeSelection(range: CalendarDateRange): DateRange {
  return {
    from: range.start,
    to: range.end,
  }
}

export function OverviewDateRangeContent({
  value,
  preset,
  onChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(value)
  const [picked, setPicked] = useState<DateRange | undefined>(() =>
    rangeSelection(value),
  )
  const [visibleMonth, setVisibleMonth] = useState(() => monthFromRangeEnd(value))
  const maxJsDate = startOfDay(new Date())
  const maxMonth = startOfMonthDate(maxJsDate)
  const canGoNext = !isAfter(addMonths(visibleMonth, 2), maxMonth)

  const commitRange = (
    nextRange: CalendarDateRange,
    nextPreset: DateRangePreset | null,
    close = false,
  ) => {
    setDraft(nextRange)
    setPicked(rangeSelection(nextRange))
    setVisibleMonth(monthFromRangeEnd(nextRange))
    onChange(nextRange, nextPreset)
    if (close) onClose()
  }

  const selectPreset = (nextPreset: DateRangePreset) => {
    commitRange(getPresetRange(nextPreset), nextPreset, true)
  }

  const selectRange = (range: DateRange | undefined) => {
    setPicked(range)
    if (!range?.from) return
    if (!range.to) {
      const start = startOfDay(range.from)
      setDraft({ start, end: start })
      return
    }
    commitRange(
      {
        start: startOfDay(range.from),
        end: startOfDay(range.to),
      },
      null,
    )
  }

  const applyDate = (field: "start" | "end", date: Date) => {
    const parsed = startOfDay(date)
    const candidate = { ...draft, [field]: parsed }
    const nextRange =
      candidate.start.getTime() <= candidate.end.getTime()
        ? candidate
        : { start: candidate.end, end: candidate.start }
    commitRange(nextRange, null)
  }

  return (
    <div className="flex max-sm:flex-col">
      <aside className="w-36 shrink-0 border-r border-border bg-muted/50 p-3 max-sm:w-full max-sm:border-r-0 max-sm:border-b">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick ranges
        </p>
        <div className="flex flex-col gap-0.5 max-sm:flex-row max-sm:overflow-x-auto">
          {(Object.keys(DATE_RANGE_PRESETS) as DateRangePreset[]).map((key) => (
            <Button
              key={key}
              variant={preset === key ? "secondary" : "ghost"}
              className="h-7 justify-start whitespace-nowrap px-3 py-0 text-xs"
              onClick={() => selectPreset(key)}
            >
              {DATE_RANGE_PRESETS[key].label}
            </Button>
          ))}
        </div>
      </aside>

      <div className="w-[26.5rem] max-w-full min-w-0 shrink-0 bg-background p-3">
        <div className="mb-3 grid min-w-0 grid-cols-2 gap-2">
          <DatePicker
            aria-label="Start date"
            value={draft.start}
            maxDate={maxJsDate}
            onChange={(date) => applyDate("start", date)}
          />
          <DatePicker
            aria-label="End date"
            value={draft.end}
            maxDate={maxJsDate}
            onChange={(date) => applyDate("end", date)}
          />
        </div>

        <div className="mb-1 flex items-center justify-between">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Previous months"
            onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} />
          </Button>
          <p className="text-sm font-medium">{formatMonthRange(visibleMonth)}</p>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Next months"
            disabled={!canGoNext}
            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} />
          </Button>
        </div>

        <Calendar
          aria-label="Overview date range"
          mode="range"
          numberOfMonths={2}
          weekStartsOn={1}
          hideNavigation
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          disabled={[{ after: maxJsDate }]}
          selected={picked}
          onSelect={selectRange}
          className="w-full p-0 [--cell-size:--spacing(7)]"
          classNames={{
            root: "w-full",
            months: "relative flex flex-row gap-2",
            month: "flex w-full min-w-0 flex-col gap-2",
            month_caption: "hidden",
            nav: "hidden",
          }}
          formatters={{
            formatWeekdayName: (day) =>
              day.toLocaleDateString("en", { weekday: "short" }),
          }}
        />
      </div>
    </div>
  )
}
