import { ArrowDown01Icon, Calendar01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { OverviewDateRangeContent } from "@/components/overview/OverviewDateRangeContent"
import {
  DATE_RANGE_PRESETS,
  type CalendarDateRange,
  type DateRangePreset,
} from "@/lib/date-ranges"

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

type Props = {
  value: CalendarDateRange
  preset: DateRangePreset | null
  /** The workspace's IANA zone — whose calendar "today" and "last 7 days" mean. */
  timezone: string
  onChange: (range: CalendarDateRange, preset: DateRangePreset | null) => void
}

export function OverviewDateRangePicker({
  value,
  preset,
  timezone,
  onChange,
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const label = preset
    ? DATE_RANGE_PRESETS[preset].label
    : value.start.getTime() === value.end.getTime()
      ? dateFormatter.format(value.start)
      : `${dateFormatter.format(value.start)} – ${dateFormatter.format(value.end)}`

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open, details) => {
        if (!open && details.reason === "outside-press") {
          const target = details.event?.target
          const element =
            target instanceof Element
              ? target
              : target instanceof Node
                ? target.parentElement
                : null
          if (element?.closest("[data-slot='date-picker-content']")) {
            details.cancel()
            return
          }
        }
        setIsOpen(open)
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="secondary" className="min-w-36 justify-between" />
        }
      >
        <HugeiconsIcon icon={Calendar01Icon} data-icon="inline-start" />
        <span className="text-sm font-medium">{label}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
      >
        {isOpen ? (
          <OverviewDateRangeContent
            value={value}
            preset={preset}
            timezone={timezone}
            onChange={onChange}
            onClose={() => setIsOpen(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
