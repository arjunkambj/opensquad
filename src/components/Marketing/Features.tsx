import {
  ArrowUpRight01Icon,
  Clock01Icon,
  Layers01Icon,
  Link01Icon,
  PauseIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/Marketing/MarketingSection"
import {
  revealCardVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"

// All names and domains in these illustrations are fictional demo data.

const panelClassName =
  "w-full max-w-sm overflow-hidden rounded-2xl bg-illustration text-foreground"

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-1 text-sm">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </div>
  )
}

function SourceChip({ domain }: { domain: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-illustration-accent px-2.5 py-1 text-xs font-medium text-illustration-accent-foreground">
      <HugeiconsIcon className="size-3.5" icon={Link01Icon} />
      {domain}
    </span>
  )
}

/** Researcher's write-up for one company: a lead finding, then two more. */
function SourceBackedResearch() {
  return (
    <div className={panelClassName}>
      <PanelHeader meta="Researcher · today" title="Northwind Studio" />
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-3">
          <p className="font-display text-2xl leading-tight tracking-tight">
            Launching online bookings this quarter.
          </p>
          <SourceChip domain="northwind.example.com" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-muted p-3.5">
          {[
            {
              claim: "Current booking form breaks on mobile",
              domain: "northwind.example.com/book",
            },
            {
              claim: "Opened a second studio in March",
              domain: "news.example.net",
            },
          ].map(({ claim, domain }) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
              key={domain}
            >
              <span>{claim}</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <HugeiconsIcon className="size-3.5" icon={Link01Icon} />
                {domain}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-muted px-5 py-3 text-xs text-muted-foreground">
        3 reasons · 3 sources · contact found: Maya Chen, Ops
      </div>
    </div>
  )
}

/** The email as Outreach wrote it, ready to go from your inbox. */
function ExactDraftApproval() {
  return (
    <div className={panelClassName}>
      <PanelHeader meta="Outreach · draft" title="New email" />
      <div className="p-4 pt-3">
        <div className="overflow-hidden rounded-xl bg-muted p-1.5">
          <div className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
            {[
              { label: "From", value: "sam@yourstudio.example" },
              { label: "To", value: "maya@northwind.example.com" },
              { label: "Subject", value: "Your new booking flow" },
            ].map(({ label, value }) => (
              <div className="flex gap-3" key={label}>
                <span className="w-12 shrink-0 text-muted-foreground">
                  {label}
                </span>
                <span className="truncate">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 rounded-lg bg-illustration px-4 py-4 text-sm leading-relaxed">
            <p>Hi Maya,</p>
            <p>
              Saw Northwind is moving to online bookings this quarter, and the
              current form breaks on mobile. We build booking pages for
              studios, usually in three weeks.
            </p>
            <p>Worth a short call next week?</p>
            <p>Sam</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-illustration-accent px-3 py-1.5 text-xs font-medium text-illustration-accent-foreground">
              <HugeiconsIcon className="size-3.5" icon={Tick02Icon} />
              OK, send
            </span>
            <span className="text-xs text-muted-foreground">Edit</span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <HugeiconsIcon className="size-3.5" icon={Clock01Icon} />
              Goes Tue 9:30, your hours
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A reply lands, the sequence stops, and a drafted answer waits. */
function InboxTakeover() {
  return (
    <div className={panelClassName}>
      <PanelHeader meta="Northwind Studio" title="Inbox" />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col items-end gap-1">
          <p className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
            Interesting, timing is good. Could we talk next week?
          </p>
          <span className="text-xs text-muted-foreground">
            Maya Chen · 10:14
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
          <HugeiconsIcon className="size-3.5" icon={PauseIcon} />
          Sequence stopped for this lead. Follow-ups cancelled.
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-muted p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Drafted reply · Outreach</span>
            <span>Waiting on you</span>
          </div>
          <p className="text-sm leading-relaxed">
            Great. Tuesday 10:30 or Wednesday 2:00? Booking link below if
            easier.
          </p>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-illustration-accent px-3 py-1.5 text-xs font-medium text-illustration-accent-foreground">
            <HugeiconsIcon className="size-3.5" icon={Tick02Icon} />
            OK, send
          </span>
        </div>
      </div>
    </div>
  )
}

const boardColumns = [
  { label: "Backlog", leads: ["Juniper Bakery"], tone: "muted" },
  { label: "Needs you", leads: ["Northwind Studio", "Harbor Dental"], tone: "accent" },
  { label: "In flight", leads: ["Fieldstone Law", "Acme Logistics"], tone: "muted" },
  { label: "Done", leads: ["Marlow & Co"], tone: "muted" },
] as const

/** Mission Control: every lead in a column, and what's waiting on you. */
function MissionControlBoard() {
  return (
    <div className={panelClassName}>
      <PanelHeader meta="This week" title="Mission Control" />
      <div className="grid grid-cols-4 gap-2.5 p-4">
        {boardColumns.map(({ label, leads, tone }) => (
          <div className="flex min-w-0 flex-col gap-2" key={label}>
            <div className="flex items-center justify-between gap-1 text-[11px]">
              <span className="truncate font-medium">{label}</span>
              <span
                className={
                  tone === "accent"
                    ? "rounded-md bg-illustration-accent px-1.5 py-0.5 text-[10px] font-semibold text-illustration-accent-foreground"
                    : "text-muted-foreground"
                }
              >
                {leads.length}
              </span>
            </div>
            {leads.map((lead) => (
              <div
                className={`truncate rounded-lg px-2 py-2 text-[11px] leading-snug ${
                  tone === "accent"
                    ? "bg-background"
                    : "bg-muted text-muted-foreground"
                }`}
                key={lead}
              >
                {lead}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 bg-muted px-5 py-3 text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <span>Reply from Maya Chen, Northwind</span>
          <span>Today 10:14</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>First email sent to Harbor Dental</span>
          <span>Tue 9:30</span>
        </div>
      </div>
    </div>
  )
}

const features = [
  {
    number: "01",
    eyebrow: "Research",
    title: "Every reason has a link",
    description:
      "A sentence and a link, not a score.",
    background: "/marketing/services/creators.webp",
    Illustration: SourceBackedResearch,
  },
  {
    number: "02",
    eyebrow: "Sending",
    title: "Real emails, from your inbox",
    description:
      "Written for one person. Sent in your hours. One tap and it's gone.",
    background: "/marketing/services/launch.webp",
    Illustration: ExactDraftApproval,
  },
  {
    number: "03",
    eyebrow: "Replies",
    title: "A reply stops the sequence",
    description:
      "Someone answers, the squad stops on that lead and drafts a reply.",
    background: "/marketing/services/strategy.webp",
    Illustration: InboxTakeover,
  },
  {
    number: "04",
    eyebrow: "The board",
    title: "You can see all of it",
    description:
      "One board. Every step dated. Close the laptop and it carries on.",
    background: "/marketing/services/creators.webp",
    Illustration: MissionControlBoard,
  },
] as const

export function Features() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="features">
      <MarketingSectionIntro
        description="Every piece shows its work."
        eyebrow="Features"
        icon={Layers01Icon}
        revealViewport={revealViewport}
        title="What's inside."
      />
      <div className="flex min-w-0 flex-col gap-6 md:gap-8">
        {features.map(
          (
            { number, eyebrow, title, description, background, Illustration },
            index,
          ) => (
            <motion.div
              className="sticky"
              initial="initial"
              key={number}
              style={{ top: `calc(6rem + ${index} * 1.25rem)` }}
              variants={revealCardVariants}
              viewport={revealViewport}
              whileInView="animate"
            >
              <Card className="grid gap-0 overflow-hidden rounded-4xl bg-popover py-0 text-popover-foreground md:grid-cols-2">
                <div className="flex flex-col justify-center gap-6 p-8 sm:p-10 lg:p-14">
                  <CardHeader className="gap-3 px-0">
                    <p className="text-xs font-semibold tracking-eyebrow text-muted-foreground uppercase">
                      {eyebrow}
                    </p>
                    <CardTitle>
                      <h3 className="text-3xl leading-tight tracking-tight sm:text-4xl">
                        {title}
                      </h3>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                      {description}
                    </p>
                  </CardContent>
                  <div>
                    <Button
                      nativeButton={false}
                      render={<Link to="/sign-in" />}
                      size="cta"
                    >
                      Get started
                      <HugeiconsIcon
                        aria-hidden="true"
                        data-icon="inline-end"
                        icon={ArrowUpRight01Icon}
                      />
                    </Button>
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className="relative isolate flex min-h-80 items-center justify-center overflow-hidden p-8 sm:min-h-[420px] lg:min-h-[480px]"
                >
                  <img
                    alt=""
                    className="absolute inset-0 -z-10 size-full object-cover"
                    decoding="async"
                    loading="lazy"
                    src={background}
                  />
                  <Illustration />
                </div>
              </Card>
            </motion.div>
          ),
        )}
      </div>
    </MarketingSection>
  )
}
