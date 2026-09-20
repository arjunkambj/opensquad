import {
  Clock01Icon,
  Layers01Icon,
  MailAccount01Icon,
  Message01Icon,
  ToggleOnIcon,
  UserBlock01Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import {
  revealCardVariants,
  revealContainerVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const controls: readonly {
  icon: IconSvgElement
  title: string
  description: string
  points: readonly string[]
}[] = [
  {
    icon: ToggleOnIcon,
    title: "Four modes, one switch",
    description:
      "How much the agent is allowed to do is a single setting you can change at any moment.",
    points: [
      "Sourcing only — finds and researches, contacts nobody",
      "Review — every email waits for you",
      "Autopilot — sends on its own, inside your limits",
      "Paused — stops everything",
    ],
  },
  {
    icon: UserCheck01Icon,
    title: "Two approvals, never one",
    description:
      "Saying yes to a person and saying yes to a piece of text are different decisions, so they are different buttons.",
    points: [
      "Approve the lead: allows finding their address and drafting",
      "Approve the email: allows that exact text, that revision",
      "Autopilot only starts after you accept a dialog listing what it will do",
    ],
  },
  {
    icon: MailAccount01Icon,
    title: "Your own sending inbox",
    description:
      "Mail leaves from your address, not ours, and the replies come back to the same place.",
    points: [
      "Connect your own inbox during setup or later",
      "Until it is connected the agent stays in Sourcing only",
      "Disconnect and the agent pauses instead of sending",
    ],
  },
  {
    icon: UserBlock01Icon,
    title: "An opt-out on every email",
    description:
      "Anyone can end it in one line, and the agent respects that without being asked twice.",
    points: [
      "Every send carries an opt-out line",
      "Someone who asks to stop is suppressed and never contacted again",
      "Your blocklist takes addresses and whole domains",
      "Checked before every send, follow-ups and replies included",
    ],
  },
  {
    icon: Clock01Icon,
    title: "Your hours, your ceiling",
    description:
      "The agent runs while you are away, but only in the window you gave it.",
    points: [
      "Sending days and hours you set",
      "A daily send limit it cannot exceed",
      "Autopilot goes through the same checks as a manual send",
    ],
  },
  {
    icon: Message01Icon,
    title: "A reply stops the sequence",
    description:
      "The moment someone answers, the queued follow-ups for that lead are cancelled — in the same step that stores the reply.",
    points: [
      "Follow-ups cancelled, unsent drafts dropped",
      "The reply is read, classified and answered",
      "Anything the agent will not answer alone is handed to you",
    ],
  },
]

export function Features() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="features">
      <MarketingSectionIntro
        description="An agent that emails strangers from your address needs brakes. These are the brakes."
        eyebrow="Controls"
        icon={Layers01Icon}
        revealViewport={revealViewport}
        title="You decide how far it goes."
      />
      <motion.div
        className="grid items-stretch gap-5 md:grid-cols-2 lg:grid-cols-3"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {controls.map(({ icon, title, description, points }) => (
          <motion.div
            className="h-full min-w-0"
            key={title}
            variants={revealCardVariants}
          >
            <Card className="h-full gap-5 rounded-4xl">
              <CardHeader className="gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-xl bg-foreground text-background"
                >
                  <HugeiconsIcon
                    className="size-[1.125rem]"
                    icon={icon}
                    strokeWidth={2}
                  />
                </span>
                <CardTitle>
                  <h3 className="text-xl leading-snug tracking-tight">
                    {title}
                  </h3>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
                <ul className="flex flex-col gap-2 border-t border-border pt-4">
                  {points.map((point) => (
                    <li
                      className="text-sm leading-relaxed text-muted-foreground"
                      key={point}
                    >
                      {point}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </MarketingSection>
  )
}
