import {
  Calendar03Icon,
  CheckmarkCircle02Icon,
  Link01Icon,
  MailOpen01Icon,
  Search01Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/Marketing/MarketingSection"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"

// All names in this timeline are fictional demo data.

const days: readonly {
  day: string
  date: string
  title: string
  description: string
  receipt: string
  who: string
  icon: IconSvgElement
}[] = [
  {
    day: "Day 1",
    date: "Mon 8 Sep",
    title: "You set up a campaign",
    description:
      "Scout comes back with five companies and a reason for each.",
    receipt: "5 companies added",
    who: "Scout",
    icon: Search01Icon,
  },
  {
    day: "Day 2",
    date: "Tue 9 Sep",
    title: "The research comes in",
    description:
      "A short write-up per company, with links.",
    receipt: "Northwind: 3 reasons, 3 links",
    who: "Researcher",
    icon: Link01Icon,
  },
  {
    day: "Day 3",
    date: "Wed 10 Sep",
    title: "The first email goes out",
    description:
      "Outreach writes it. A quick OK from you, and it's gone.",
    receipt: "First email sent, 9:30",
    who: "Outreach",
    icon: UserCheck01Icon,
  },
  {
    day: "Day 5",
    date: "Fri 12 Sep",
    title: "Someone writes back",
    description:
      "Maya at Northwind asks for a call. A reply is drafted.",
    receipt: "Maya replied · waiting on you",
    who: "Inbox",
    icon: MailOpen01Icon,
  },
  {
    day: "Day 7",
    date: "Mon 15 Sep",
    title: "First meeting on the calendar",
    description:
      "Thursday at two. Four companies still moving.",
    receipt: "Meeting booked, Thu 2 pm",
    who: "You",
    icon: CheckmarkCircle02Icon,
  },
]

/** The Mission Control activity feed after that same week. */
function ActivityFeed() {
  return (
    <div className="flex h-full w-full max-w-md flex-col rounded-2xl bg-illustration p-6 text-foreground">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Activity</span>
        <span className="text-muted-foreground">Northwind Studio</span>
      </div>
      <ol className="mt-4 flex flex-1 flex-col justify-between gap-2">
        {days.map(({ day, receipt, icon }, index) => (
          <li
            className={`flex flex-1 items-center gap-4 rounded-xl px-3 py-3 ${index === days.length - 1 ? "bg-muted" : "text-muted-foreground"}`}
            key={day}
          >
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${index === days.length - 1 ? "bg-illustration-accent text-illustration-accent-foreground" : "bg-muted"}`}
            >
              <HugeiconsIcon className="size-5" icon={icon} />
            </span>
            <p className="min-w-0 flex-1 truncate text-base">{receipt}</p>
            <span className="shrink-0 text-sm text-muted-foreground">
              {day}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** A believable first week, told through the notes the board keeps. */
export function FirstWeek() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="first-week">
      <MarketingSectionIntro
        description="One campaign, five companies, as the board records it."
        eyebrow="Your first week"
        icon={Calendar03Icon}
        revealViewport={revealViewport}
        title="The first week."
      />
      <div className="grid items-start gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <motion.ol
          className="flex flex-col"
          initial="initial"
          variants={revealContainerVariants}
          viewport={revealViewport}
          whileInView="animate"
        >
          {days.map(({ day, title, description }) => (
            <motion.li
              className="grid gap-2 border-t border-border py-7 last:border-b sm:grid-cols-[5.5rem_1fr] sm:gap-8"
              key={day}
              variants={revealItemVariants}
            >
              <p className="font-display text-2xl tracking-tight">{day}</p>
              <div className="flex max-w-xl flex-col gap-2">
                <h3 className="text-xl tracking-tight">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </motion.li>
          ))}
        </motion.ol>
        <motion.div
          aria-hidden="true"
          className="relative isolate flex min-h-96 items-stretch justify-center overflow-hidden rounded-4xl p-7 sm:p-10 lg:h-full"
          initial="initial"
          variants={revealItemVariants}
          viewport={revealViewport}
          whileInView="animate"
        >
          <img
            alt=""
            className="absolute inset-0 -z-10 size-full object-cover"
            decoding="async"
            loading="lazy"
            src="/marketing/services/launch.webp"
          />
          <ActivityFeed />
        </motion.div>
      </div>
    </MarketingSection>
  )
}
