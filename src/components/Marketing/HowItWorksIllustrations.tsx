import {
  Calendar03Icon,
  Link01Icon,
  Mail01Icon,
  Tick02Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

const badgeClassName =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-lg bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground"

export function DiscoverIllustration() {
  return (
    <div className="w-full max-w-72 -rotate-5 rounded-xl bg-illustration p-5">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Scout found
      </p>
      <div className="mt-5 flex flex-col gap-3">
        {[
          { name: "Harbor Dental", fit: "w-11/12" },
          { name: "Fieldstone Law", fit: "w-4/5" },
          { name: "Juniper Bakery", fit: "w-2/3" },
        ].map(({ name, fit }) => (
          <div className="flex items-center gap-3" key={name}>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-medium text-xs">
              {name.charAt(0)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="truncate font-medium text-sm">{name}</span>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className={`h-full rounded-full bg-illustration-accent ${fit}`}
                />
              </div>
            </div>
            <HugeiconsIcon className="size-4 shrink-0" icon={Tick02Icon} />
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Up to five that fit the campaign.
      </p>
    </div>
  )
}

export function ResearchIllustration() {
  return (
    <>
      <div className="w-full max-w-72 -rotate-3 rounded-xl bg-illustration p-5">
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          Opportunity
        </p>
        <p className="mt-4 font-display text-2xl leading-tight tracking-tight">
          Booking form breaks on mobile.
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {["Homepage", "Contact page"].map((source, index) => (
            <span className={badgeClassName} key={source}>
              <HugeiconsIcon className="size-3" icon={Link01Icon} />
              {`[${index + 1}] ${source}`}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <HugeiconsIcon className="size-4" icon={UserCheck01Icon} />
          Owner contact enriched
        </div>
      </div>
      <div className="absolute right-6 bottom-5 rotate-5 rounded-md bg-foreground px-4 py-2.5 text-xs text-background">
        Every claim has a source.
      </div>
    </>
  )
}

export function ApproveIllustration() {
  return (
    <div className="w-full max-w-72 rotate-3 rounded-xl bg-illustration p-5">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Exact draft
      </p>
      <div className="mt-4 flex items-center gap-2">
        <HugeiconsIcon className="size-4" icon={Mail01Icon} />
        <p className="truncate font-medium">Quick fix for your booking form</p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="h-2 w-full rounded-full bg-muted" />
        <div className="h-2 w-11/12 rounded-full bg-muted" />
        <div className="h-2 w-3/5 rounded-full bg-muted" />
      </div>
      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Your call.</span>
        <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-illustration-accent px-3 text-xs font-medium text-illustration-accent-foreground">
          <HugeiconsIcon className="size-3.5" icon={Tick02Icon} />
          Approve
        </span>
      </div>
    </div>
  )
}

export function BookIllustration() {
  return (
    <div className="w-full max-w-72 -rotate-4 rounded-xl bg-illustration p-5">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Shared inbox
      </p>
      <div className="mt-4 w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
        Sounds useful. When are you free?
      </div>
      <div className="mt-2 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-illustration-accent px-3 py-2 text-sm text-illustration-accent-foreground">
        Thursday 10:00 or 14:30?
      </div>
      <div className="mt-5 flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <HugeiconsIcon className="size-4" icon={Calendar03Icon} />
          Thu, 10:00
        </span>
        <span className={badgeClassName}>Meeting recorded</span>
      </div>
    </div>
  )
}
