import {
  ArrowUpRight01Icon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

const slots = [
  { day: "Tue", time: "10:30", note: "Proposed" },
  { day: "Wed", time: "14:00", note: "Backup" },
]

/**
 * A short reply thread for the closing CTA: a prospect answers, Outreach
 * drafts a booking reply with proposed slots, and nothing sends until a
 * human approves. The hero already shows the approval screen, so this panel
 * shows a real conversation moving forward instead.
 */
export function CtaPreview() {
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-background text-foreground sm:min-h-[520px]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5 text-sm sm:px-7">
        <span className="font-medium">Inbox</span>
        <span className="text-xs text-muted-foreground">
          Sienna Whitlock · Northwind Studio
        </span>
      </div>
      <div className="flex flex-col gap-6 p-3 sm:p-7">
        <div className="flex flex-col items-end gap-1">
          <p className="max-w-xs rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
            Timing is good, we are rebuilding the booking flow this quarter.
            Happy to talk next week.
          </p>
          <span className="text-xs text-muted-foreground">
            Sienna Whitlock · 10:14
          </span>
        </div>

        <div className="flex flex-col gap-4 rounded-xl bg-muted p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[0.625rem] font-semibold text-background"
            >
              O
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Drafted reply · Outreach
              </span>
              <p className="text-sm leading-relaxed">
                Sienna replied with interest. I drafted a reply with two slots and
                your booking link. One tap and it goes.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {slots.map((slot) => (
              <div
                className="flex items-center gap-3 rounded-lg bg-background px-3 py-2.5"
                key={slot.day}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <HugeiconsIcon className="size-4" icon={Calendar03Icon} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {slot.day} {slot.time}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    30 min intro call
                  </p>
                </div>
                <span className="hidden h-5 w-fit shrink-0 items-center justify-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground sm:inline-flex">
                  {slot.note}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1 rounded-2xl bg-primary px-3 pr-2 text-sm font-medium text-primary-foreground">
              Approve and send
              <HugeiconsIcon className="size-4" icon={ArrowUpRight01Icon} />
            </span>
            <span className="inline-flex h-7 items-center rounded-2xl bg-background px-3 text-sm font-medium">
              Edit draft
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              Proposed Tue 10:30 · waiting on you
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
