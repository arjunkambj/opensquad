import { Calendar03Icon } from "@hugeicons/core-free-icons"
import { CompanyMark } from "@/components/Marketing/CompanyMark"
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
}[] = [
  {
    day: "Day 1",
    date: "Mon 8 Sep",
    title: "You set up a campaign",
    description:
      "Scout comes back with five companies and a reason for each.",
  },
  {
    day: "Day 2",
    date: "Tue 9 Sep",
    title: "The research comes in",
    description:
      "A short write-up per company, with links.",
  },
  {
    day: "Day 3",
    date: "Wed 10 Sep",
    title: "The first email goes out",
    description:
      "Outreach writes it. A quick OK from you, and it's gone.",
  },
  {
    day: "Day 5",
    date: "Fri 12 Sep",
    title: "Someone writes back",
    description:
      "Sienna at Northwind asks for a call. A reply is drafted.",
  },
  {
    day: "Day 7",
    date: "Mon 15 Sep",
    title: "First meeting on the calendar",
    description:
      "Thursday at two. Four companies still moving.",
  },
]

const leadsOnDaySeven = [
  { company: "Northwind Studio", contact: "Sienna Whitlock", stage: "Meeting booked", note: "Thu 2:00 pm", hot: true },
  { company: "Harbor Dental", contact: "Tobias Ferreira", stage: "Replied", note: "Draft waiting on you", hot: false },
  { company: "Fieldstone Law", contact: "Lena Okonkwo", stage: "Emailed", note: "Sent Thu 9:30", hot: false },
  { company: "Juniper Bakery", contact: "Anaya Bhatt", stage: "Emailed", note: "Sent Fri 9:30", hot: false },
  { company: "Acme Logistics", contact: "Rafael Duarte", stage: "Researching", note: "2 sources so far", hot: false },
] as const

/** Where the five companies stand at the end of that week. */
function LeadsBoard() {
  return (
    <div className="flex h-full w-full max-w-md flex-col rounded-2xl bg-illustration p-4 text-foreground sm:p-6">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Leads</span>
        <span className="text-muted-foreground">Day 7 · 5 companies</span>
      </div>
      <ol className="mt-4 flex flex-1 flex-col justify-between gap-2">
        {leadsOnDaySeven.map(({ company, contact, stage, note, hot }) => (
          <li
            className={`flex flex-1 items-center gap-3 rounded-xl px-2.5 py-2.5 sm:gap-4 sm:px-3 sm:py-3 ${hot ? "bg-muted" : ""}`}
            key={company}
          >
            <CompanyMark company={company} />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm sm:text-base">{company}</p>
              <p className="truncate text-xs text-muted-foreground">
                {contact} · {note}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium sm:px-2 sm:text-xs ${
                hot
                  ? "bg-illustration-accent text-illustration-accent-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {stage}
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
          className="relative isolate flex min-h-96 items-stretch justify-center overflow-hidden rounded-4xl p-4 sm:p-10 lg:h-full"
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
          <LeadsBoard />
        </motion.div>
      </div>
    </MarketingSection>
  )
}
