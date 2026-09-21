import { Radar01Icon } from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"

/** What actually happens after you sign up, in order. No dates, no numbers. */
const steps = [
  {
    step: "01",
    title: "You paste your website",
    description:
      "It reads the site and comes back with your company profile, who you sell to and what you tend to solve. You fix anything it misread.",
  },
  {
    step: "02",
    title: "You connect your sending inbox",
    description:
      "Setup asks for this before it goes looking, and skipping it is allowed: the agent stays in Sourcing only, finding and researching and contacting nobody. Connecting one starts nothing either — how it sends is a separate choice, made by you.",
  },
  {
    step: "03",
    title: "You pick the signals",
    description:
      "It proposes a few named searches from your own profile and shows how many people each one matches, before anything is spent.",
  },
  {
    step: "04",
    title: "You confirm, and the first leads land",
    description:
      "The searches run, every lead arrives tagged with the signal that found it, and the strongest few are researched and scored first. The rest wait with a Research button.",
  },
  {
    step: "05",
    title: "You approve the first lead and the first email",
    description:
      "Once you have put the agent in Review, it finds the address and writes the email, and it goes out inside your window only after you say yes to that exact text. Two follow-ups go out only if nobody answers.",
  },
  {
    step: "06",
    title: "A reply comes in",
    description:
      "The follow-ups stop for that lead, the reply is read and answered, a time is proposed. When it is actually agreed, you mark the meeting booked.",
  },
] as const

/** The five things the agent is never allowed to do by itself. */
const neverAlone = [
  "Send anything before you connect your own inbox",
  "Send in Review mode without your approval of that exact text",
  "Switch itself to Autopilot",
  "Email an address on your blocklist, or anyone who asked to stop",
  "Mark a meeting as booked",
] as const

export function FirstRun() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="first-run">
      <MarketingSectionIntro
        description="No import, no list to buy, nothing to configure first."
        eyebrow="Your first run"
        icon={Radar01Icon}
        revealViewport={revealViewport}
        title="What happens after you sign up."
      />
      <div className="grid items-start gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <motion.ol
          className="flex flex-col"
          initial="initial"
          variants={revealContainerVariants}
          viewport={revealViewport}
          whileInView="animate"
        >
          {steps.map(({ step, title, description }) => (
            <motion.li
              className="grid gap-2 border-t border-border py-7 last:border-b sm:grid-cols-[5.5rem_1fr] sm:gap-8"
              key={step}
              variants={revealItemVariants}
            >
              <p className="font-display text-2xl tracking-tight text-muted-foreground">
                {step}
              </p>
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
          className="relative isolate overflow-hidden rounded-4xl p-4 sm:p-8 lg:sticky lg:top-40"
          initial="initial"
          variants={revealItemVariants}
          viewport={revealViewport}
          whileInView="animate"
        >
          <img
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-10 size-full object-cover"
            decoding="async"
            loading="lazy"
            src="/marketing/services/launch.webp"
          />
          <div className="flex flex-col gap-4 rounded-2xl bg-illustration p-6 text-foreground">
            <h3 className="text-lg tracking-tight">
              What it never does on its own
            </h3>
            <ul className="flex flex-col gap-2.5">
              {neverAlone.map((item) => (
                <li
                  className="rounded-xl bg-muted px-3.5 py-2.5 text-sm leading-relaxed"
                  key={item}
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>
    </MarketingSection>
  )
}
