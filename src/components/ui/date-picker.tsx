import { Calendar01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

type DatePickerProps = {
  value?: Date
  onChange: (date: Date) => void
  minDate?: Date
  maxDate?: Date
  placeholder?: string
  id?: string
  "aria-label"?: string
  className?: string
}

export function DatePicker({
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Pick a date",
  id,
  "aria-label": ariaLabel,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(value ?? new Date())
  const wasOpen = useRef(open)

  // Initialize the visible month when the popover opens. `value` is often a
  // fresh Date instance on every parent render, so reacting to it while the
  // popover is open would snap the calendar back to the selected month.
  useEffect(() => {
    if (open && !wasOpen.current) setMonth(value ?? new Date())
    wasOpen.current = open
  }, [open, value])

  const disabled = [
    ...(maxDate ? [{ after: maxDate }] : []),
    ...(minDate ? [{ before: minDate }] : []),
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            size="sm"
            variant="secondary"
            aria-label={ariaLabel}
            className={cn("min-w-0 w-full justify-between font-normal", className)}
          />
        }
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value ? dateFormatter.format(value) : placeholder}
        </span>
        <HugeiconsIcon icon={Calendar01Icon} data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        data-slot="date-picker-content"
        align="start"
        className="w-auto p-0"
      >
        <Calendar
          mode="single"
          weekStartsOn={1}
          month={month}
          onMonthChange={setMonth}
          selected={value}
          onSelect={(date) => {
            if (!date) return
            onChange(date)
            setOpen(false)
          }}
          disabled={disabled.length > 0 ? disabled : undefined}
        />
      </PopoverContent>
    </Popover>
  )
}
