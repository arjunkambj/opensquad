import { AiUserIcon, Link01Icon } from "@hugeicons/core-free-icons"
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
// Avatars are licensed placeholder portraits, not the people named.

const prospects = [
  {
    name: "Sienna Whitlock",
    role: "Ops lead · Northwind Studio",
    reason: "Moving to online bookings",
    avatar: "/marketing/avatars/sienna.jpg",
    platform: "LinkedIn",
    logo: "/marketing/logos/linkedin.svg",
  },
  {
    name: "Tobias Ferreira",
    role: "Founder · Harbor Dental",
    reason: "Opened a second clinic",
    avatar: "/marketing/avatars/tobias.jpg",
    platform: "Y Combinator",
    logo: "/marketing/logos/ycombinator.svg",
  },
  {
    name: "Anaya Bhatt",
    role: "Owner · Juniper Bakery",
    reason: "Posting about pre-orders",
    avatar: "/marketing/avatars/anaya.jpg",
    platform: "Instagram",
    logo: "/marketing/logos/instagram.svg",
  },
] as const

/** Scout's output: the people behind the companies, and where it found them. */
function ScoutOutput() {
  return (
    <div className="flex w-full max-w-64 flex-col gap-2">
      {prospects.map(({ name, role, reason, avatar, platform, logo }) => (
        <div
          className="flex items-center gap-3 rounded-xl bg-illustration px-3 py-2"
          key={name}
        >
          <img
            alt=""
            className="size-9 shrink-0 rounded-full bg-muted object-cover"
            decoding="async"
            loading="lazy"
            src={avatar}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{role}</p>
            <p className="mt-0.5 truncate text-[11px]">{reason}</p>
          </div>
          <img
            alt={platform}
            className="size-4 shrink-0"
            decoding="async"
            loading="lazy"
            src={logo}
            title={platform}
          />
        </div>
      ))}
    </div>
  )
}

const pagesRead = [
  { page: "northwind.example.com/book", found: "Form fails on mobile" },
  { page: "northwind.example.com/about", found: "Second studio, March" },
  { page: "news.example.net", found: "Online booking launch" },
] as const

/** Researcher's work: the pages it read, and what each one gave it. */
function ResearcherOutput() {
  return (
    <div className="w-full max-w-64 rounded-xl bg-illustration p-4">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Reading Northwind Studio</span>
        <span className="text-muted-foreground">3 pages</span>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {pagesRead.map(({ page, found }) => (
          <div className="rounded-lg bg-muted px-3 py-2" key={page}>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <HugeiconsIcon className="size-3 shrink-0" icon={Link01Icon} />
              {page}
            </p>
            <p className="mt-0.5 text-xs">{found}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Contact found: Sienna Whitlock, Ops
      </p>
    </div>
  )
}

const sendTimeline = [
  { label: "Sent from your inbox", when: "Tue 9:30", hot: false },
  { label: "Opened", when: "Wed 8:12", hot: false },
  { label: "Replied: could we talk next week?", when: "Thu 10:14", hot: true },
] as const

/** Outreach's result: what came back after the send. */
function OutreachOutput() {
  return (
    <div className="w-full max-w-64 rounded-xl bg-illustration p-4">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Your new booking flow</span>
        <span className="text-muted-foreground">to Sienna</span>
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {sendTimeline.map(({ label, when, hot }) => (
          <li
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs ${
              hot ? "bg-illustration-accent text-illustration-accent-foreground" : "bg-muted"
            }`}
            key={label}
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className={hot ? "shrink-0 opacity-90" : "shrink-0 text-muted-foreground"}>
              {when}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

const members = [
  {
    name: "Scout",
    title: "Finds companies that fit",
    description: "Up to five per campaign, with the person to write to.",
    background: "/marketing/services/creators.webp",
    Illustration: ScoutOutput,
  },
  {
    name: "Researcher",
    title: "Reads up on each one",
    description: "Their website, their news, and one reason to write.",
    background: "/marketing/services/launch.webp",
    Illustration: ResearcherOutput,
  },
  {
    name: "Outreach",
    title: "Writes and sends the email",
    description: "From your inbox, in your hours. Replies come back to you.",
    background: "/marketing/services/strategy.webp",
    Illustration: OutreachOutput,
  },
] as const

/** The three stages of the outbound agent, and what each one does. */
export function Squad() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="squad">
      <MarketingSectionIntro
        description="Give it a campaign and it takes the rest from there."
        eyebrow="What it does"
        icon={AiUserIcon}
        revealViewport={revealViewport}
        title="Three steps. One job each."
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
