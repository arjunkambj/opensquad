import {
  Calendar03Icon,
  Link01Icon,
  Tick02Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { CompanyMark } from "@/components/marketing/CompanyMark"

const badgeClassName =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-lg bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground"

const leadDefinition = [
  { label: "Company", value: "Studios, 5 to 30 people" },
  { label: "Where", value: "Portland" },
  { label: "Who", value: "Owner or ops lead" },
  { label: "Signal", value: "Moving to online bookings" },
] as const

export function DiscoverIllustration() {
  return (
    <div className="w-full max-w-72 -rotate-5 rounded-xl bg-illustration p-5">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Your ideal lead
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        {leadDefinition.map(({ label, value }) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-xs"
            key={label}
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate font-medium">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Scout is on it</span>
        <span className="flex items-center gap-1.5 font-medium">
          <HugeiconsIcon className="size-3.5" icon={Tick02Icon} />5 companies
          found
        </span>
      </div>
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
          {[
            { name: "LinkedIn", logo: "/marketing/logos/linkedin.svg" },
            { name: "Y Combinator", logo: "/marketing/logos/ycombinator.svg" },
            { name: "Website", logo: null },
          ].map(({ name, logo }) => (
            <span className={badgeClassName} key={name}>
              {logo ? (
                <img alt="" className="size-3" decoding="async" src={logo} />
              ) : (
                <HugeiconsIcon className="size-3" icon={Link01Icon} />
              )}
              {name}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <HugeiconsIcon className="size-4" icon={UserCheck01Icon} />
          Owner contact found
        </div>
      </div>
      <div className="absolute right-6 bottom-5 rotate-5 rounded-md bg-foreground px-4 py-2.5 text-xs text-background">
        Every claim has a source.
      </div>
    </>
  )
}

const sendChecks = [
  "From your inbox",
  "Inside sending hours, Tue 9:30",
  "Not on the do-not-email list",
  "OK'd by you",
] as const

export function ApproveIllustration() {
  return (
    <div className="w-full max-w-72 rotate-3 rounded-xl bg-illustration p-5">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Before it sends
      </p>
      <div className="mt-4 flex flex-col gap-1.5">
        {sendChecks.map((check) => (
          <div
            className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs"
            key={check}
          >
            <HugeiconsIcon className="size-3.5 shrink-0" icon={Tick02Icon} />
            {check}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Your new booking flow
        </span>
        <span className="rounded-lg bg-illustration-accent px-3 py-1.5 text-xs font-medium text-illustration-accent-foreground">
          Sending
        </span>
      </div>
    </div>
  )
}

export function BookIllustration() {
  return (
    <div className="w-full max-w-72 -rotate-4 rounded-xl bg-illustration p-5">
      <div className="flex items-center gap-3">
        <CompanyMark className="size-9 rounded-lg" company="Northwind Studio" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">Northwind Studio</span>
          <span className="truncate text-[11px] text-muted-foreground">
            Sienna Whitlock, Ops
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5 text-xs">
        {[
          { label: "Stage", value: "Meeting booked" },
          { label: "Owner", value: "You" },
          { label: "Next", value: "Prep for the call" },
        ].map(({ label, value }) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2"
            key={label}
          >
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs">
        <HugeiconsIcon className="size-4" icon={Calendar03Icon} />
        Thu 2:00 pm · 30 min intro call
      </div>
    </div>
  )
}
