import {
  ArrowRight02Icon,
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
  revealItemVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"

// All names and domains in these illustrations are fictional demo data.

const researchClaims = [
  {
    claim: "Launching a new booking flow this quarter",
    source: "northwind.example.com",
  },
  { claim: "Hiring a product designer", source: "jobs.example.org" },
  { claim: "Site still on a 2019 theme", source: "archive.example.net" },
] as const

function SourceBackedResearch() {
  return (
    <div className="relative flex w-full max-w-64 flex-col gap-4">
      <div className="ml-4 rotate-3 rounded-2xl bg-foreground p-4 text-background shadow-xl">
        <p className="text-sm leading-relaxed">
          Why is Northwind Studio worth a first email?
        </p>
      </div>
      <div className="-rotate-3 rounded-2xl border border-border bg-illustration p-5 text-foreground shadow-2xl shadow-foreground/20">
        <p className="mb-5 text-sm font-medium">Three reasons, with receipts.</p>
        <div className="flex flex-col gap-4">
          {researchClaims.map(({ claim, source }) => (
            <div className="flex flex-col gap-1.5" key={source}>
              <p className="text-xs leading-snug">{claim}</p>
              <span className="inline-flex w-fit items-center gap-1 rounded-md bg-illustration-accent/25 px-2 py-0.5 text-[10px] text-muted-foreground">
                <HugeiconsIcon className="size-3" icon={Link01Icon} />
                {source}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExactDraftApproval() {
  return (
    <div className="w-full max-w-64 rotate-3 rounded-2xl border border-border bg-illustration p-5 text-foreground shadow-2xl shadow-foreground/20">
      <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
        <HugeiconsIcon className="size-4" icon={Tick02Icon} />
        Nothing sends without you
      </div>
      <p className="text-base font-medium">Your booking flow</p>
      <p className="mt-1 text-xs text-muted-foreground">
        To Maya Chen, Northwind Studio
      </p>
      <div className="my-6 flex flex-col gap-2">
        <div className="h-1.5 w-full rounded-full bg-muted" />
        <div className="h-1.5 w-11/12 rounded-full bg-muted" />
        <div className="h-1.5 w-4/5 rounded-full bg-illustration-accent" />
        <div className="h-1.5 w-3/5 rounded-full bg-muted" />
      </div>
      <div className="mb-4 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">Approved words</span>
        <HugeiconsIcon
          className="size-4 text-muted-foreground"
          icon={ArrowRight02Icon}
        />
        <span className="rounded-lg bg-illustration-accent px-3 py-1.5 font-medium text-illustration-accent-foreground">
          Sent words
        </span>
      </div>
      <div className="rounded-lg bg-illustration-accent/25 px-3 py-2.5 text-center text-xs text-foreground">
        Sends Tue, 9:30 am, inside your window
      </div>
    </div>
  )
}

function InboxTakeover() {
  return (
    <div className="relative flex w-full max-w-64 flex-col gap-4">
      <div className="mr-4 -rotate-3 rounded-2xl border border-border bg-illustration p-4 text-foreground shadow-xl shadow-foreground/20">
        <p className="text-xs text-muted-foreground">Reply from Maya Chen</p>
        <p className="mt-2 text-sm leading-relaxed">
          Interesting. Could we talk next week?
        </p>
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] text-background">
          <HugeiconsIcon className="size-3.5" icon={PauseIcon} />
          You took over. Automation paused.
        </div>
      </div>
      <div className="ml-4 rotate-3 rounded-2xl border border-border bg-illustration p-5 text-foreground shadow-2xl shadow-foreground/20">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium">Northwind Studio</span>
          <span className="rounded-md bg-illustration-accent px-2 py-0.5 text-illustration-accent-foreground">
            Replied
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-2.5 text-xs">
          {[
            { label: "Owner", value: "You" },
            { label: "Why", value: "Asked for a call" },
            { label: "Next", value: "Propose slots" },
          ].map(({ label, value }) => (
            <div className="flex justify-between gap-3" key={label}>
              <span className="text-muted-foreground">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <HugeiconsIcon className="size-3.5" icon={Clock01Icon} />
          Due tomorrow
        </div>
      </div>
    </div>
  )
}

const boardColumns = [
  { label: "Backlog", count: 2, opacity: "opacity-35" },
  { label: "Needs you", count: 3, opacity: "opacity-100" },
  { label: "In flight", count: 4, opacity: "opacity-60" },
  { label: "Done", count: 6, opacity: "opacity-85" },
] as const

function MissionControlBoard() {
  return (
    <div className="w-full max-w-64 -rotate-6 rounded-2xl border border-border bg-illustration p-5 text-foreground shadow-2xl shadow-foreground/20">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Mission Control</span>
        <span className="text-muted-foreground">This week</span>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">Waiting on you</p>
      <p className="mt-1 font-display text-4xl tracking-tight">3</p>
      <div className="mt-6 grid grid-cols-4 gap-2">
        {boardColumns.map(({ label, count, opacity }) => (
          <div className="flex flex-col gap-1.5" key={label}>
            {Array.from({ length: Math.min(count, 4) }, (_, index) => (
              <div
                className={`h-3 rounded-sm bg-illustration-accent ${opacity}`}
                key={index}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-[9px] leading-tight text-muted-foreground">
        {boardColumns.map(({ label }) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mt-4 flex justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>Sent to Maya Chen</span>
        <span>Sep 14</span>
      </div>
    </div>
  )
}

const features = [
  {
    number: "01",
    title: "Research that shows its sources",
    description:
      "Scout finds up to five companies that fit your campaign. Researcher builds the case for each one, and every claim links to the page it came from, so you can check the evidence before anyone is contacted.",
    background: "/marketing/services/creators.webp",
    Illustration: SourceBackedResearch,
  },
  {
    number: "02",
    title: "The words you approve are the words that send",
    description:
      "Outreach prepares the exact email, and you approve it word for word. It sends from your workspace inbox only inside your sending windows, never to a suppressed address, and you can pause automation at any time.",
    background: "/marketing/services/launch.webp",
    Illustration: ExactDraftApproval,
  },
  {
    number: "03",
    title: "Replies, takeover and a real Leads CRM",
    description:
      "Real replies land in a shared inbox. A reply, an opt-out or a human takeover freezes automation for that lead. In Leads, every company has an owner, a stage with its reason, and a due next action, and unscheduled is a real state.",
    background: "/marketing/services/strategy.webp",
    Illustration: InboxTakeover,
  },
  {
    number: "04",
    title: "Mission Control on a runtime that keeps going",
    description:
      "See every campaign as Backlog, Needs you, In flight and Done, with dated receipts. Agents run with Codex in one isolated sandbox per workspace, and durable workflows pick up where they left off after a restart.",
    background: "/marketing/services/creators.webp",
    Illustration: MissionControlBoard,
  },
] as const

export function Features() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="features">
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.6fr] lg:gap-16">
        <div className="lg:sticky lg:top-40">
          <MarketingSectionIntro
            description="Three AI employees do the finding, the research and the drafting. You make every call that matters."
            eyebrow="Features"
            icon={Layers01Icon}
            revealViewport={revealViewport}
            spacing="none"
            title="A sales team you supervise."
          >
            <motion.div className="mt-2" variants={revealItemVariants}>
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
            </motion.div>
          </MarketingSectionIntro>
        </div>
        <div className="flex min-w-0 flex-col gap-6 md:gap-20 lg:gap-28">
          {features.map(
            ({ number, title, description, background, Illustration }) => (
              <motion.div
                initial="initial"
                key={number}
                variants={revealCardVariants}
                viewport={revealViewport}
                whileInView="animate"
              >
                <Card className="grid gap-0 rounded-4xl bg-popover px-2 py-0 text-popover-foreground sm:grid-cols-2">
                  <div className="flex flex-col justify-center gap-5 px-2 py-8 sm:py-12">
                    <CardHeader className="gap-2 px-5">
                      <p className="text-sm text-muted-foreground">{number}</p>
                      <CardTitle>
                        <h3 className="text-3xl leading-tight tracking-tight">
                          {title}
                        </h3>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5">
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {description}
                      </p>
                    </CardContent>
                  </div>
                  <div
                    aria-hidden="true"
                    className="relative isolate flex min-h-80 items-center justify-center overflow-hidden p-7 sm:min-h-100"
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
      </div>
    </MarketingSection>
  )
}
