import {
  AiUserIcon,
  Clock01Icon,
  Link01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/Marketing/MarketingSection"
import {
  revealCardVariants,
  revealContainerVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// All names and domains in these mockups are fictional demo data.

/** Scout's output: a short list of companies that fit. */
function ScoutOutput() {
  return (
    <div className="w-full max-w-60 -rotate-3 rounded-xl bg-illustration p-5">
      <p className="text-xs text-muted-foreground">Scout found</p>
      <div className="mt-4 flex flex-col gap-3">
        {["Northwind Studio", "Harbor Dental", "Fieldstone Law"].map(
          (name) => (
            <div className="flex items-center gap-3" key={name}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium">
                {name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <HugeiconsIcon className="size-4 shrink-0" icon={Tick02Icon} />
            </div>
          ),
        )}
      </div>
      <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        5 of 5, each with a reason
      </p>
    </div>
  )
}

/** Researcher's output: one finding, with its source. */
function ResearcherOutput() {
  return (
    <div className="w-full max-w-60 rotate-2 rounded-xl bg-illustration p-5">
      <p className="text-xs text-muted-foreground">Northwind Studio</p>
      <p className="mt-2 font-display text-xl leading-tight tracking-tight">
        Launching online bookings this quarter.
      </p>
      <span className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg bg-illustration-accent px-2.5 py-1 text-xs font-medium text-illustration-accent-foreground">
        <HugeiconsIcon className="size-3.5" icon={Link01Icon} />
        northwind.example.com
      </span>
    </div>
  )
}

/** Outreach's output: the email, sent from your inbox. */
function OutreachOutput() {
  return (
    <div className="w-full max-w-60 -rotate-2 rounded-xl bg-illustration p-5">
      <p className="text-xs text-muted-foreground">To Maya Chen, Northwind</p>
      <p className="mt-1.5 text-sm font-medium">Your new booking flow</p>
      <div className="my-4 flex flex-col gap-2">
        <div className="h-1.5 w-full rounded-full bg-muted" />
        <div className="h-1.5 w-4/5 rounded-full bg-muted" />
        <div className="h-1.5 w-3/5 rounded-full bg-muted" />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 font-medium text-background">
          <HugeiconsIcon className="size-3" icon={Tick02Icon} />
          Sent from you
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <HugeiconsIcon className="size-3.5" icon={Clock01Icon} />
          Tue 9:30
        </span>
      </div>
    </div>
  )
}

const members = [
  {
    name: "Scout",
    title: "Finds companies that fit",
    description: "Up to five per campaign, each with a reason.",
    background: "/marketing/services/creators.webp",
    Illustration: ScoutOutput,
  },
  {
    name: "Researcher",
    title: "Reads up on each one",
    description: "What they do and what changed, with links.",
    background: "/marketing/services/launch.webp",
    Illustration: ResearcherOutput,
  },
  {
    name: "Outreach",
    title: "Writes and sends the email",
    description: "From your inbox, in your hours. Replies come back to one place.",
    background: "/marketing/services/strategy.webp",
    Illustration: OutreachOutput,
  },
] as const

/** The three AI employees and the one thing each of them does. */
export function Squad() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="squad">
      <MarketingSectionIntro
        description="Give it a campaign and they take it from there."
        eyebrow="What it does"
        icon={AiUserIcon}
        revealViewport={revealViewport}
        title="Three AI employees. One job each."
      />
      <motion.div
        className="grid gap-5 md:grid-cols-3"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {members.map(
          ({ name, title, description, background, Illustration }) => (
            <motion.div
              className="h-full min-w-0"
              key={name}
              variants={revealCardVariants}
            >
              <Card className="h-full gap-0 bg-popover pt-0 text-popover-foreground [--card-spacing:--spacing(7)]">
                <div
                  aria-hidden="true"
                  className="relative isolate flex aspect-[1.25] items-center justify-center overflow-hidden p-7"
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
                <CardHeader className="gap-2 pt-(--card-spacing)">
                  <p className="text-sm text-muted-foreground">{name}</p>
                  <CardTitle>
                    <h3 className="text-2xl tracking-tight">{title}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="pt-3 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ),
        )}
      </motion.div>
    </MarketingSection>
  )
}
