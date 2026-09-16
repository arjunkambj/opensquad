import { PlayIcon } from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import {
  ApproveIllustration,
  BookIllustration,
  DiscoverIllustration,
  ResearchIllustration,
} from "@/components/Marketing/HowItWorksIllustrations"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/Marketing/MarketingSection"
import {
  revealCardVariants,
  revealContainerVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const steps = [
  {
    title: "Discover",
    description:
      "Scout finds up to five companies that fit the campaign you confirmed, and lays them out on the board.",
    tags: ["Mission Control", "Scout"],
    background: "/marketing/services/creators.webp",
    Illustration: DiscoverIllustration,
  },
  {
    title: "Research",
    description:
      "Researcher digs into each company, cites the sources behind every finding, and enriches qualified contacts.",
    tags: ["Leads", "Researcher"],
    background: "/marketing/services/launch.webp",
    Illustration: ResearchIllustration,
  },
  {
    title: "Approve",
    description:
      "You review the exact draft Outreach wrote, word for word. Nothing sends without you.",
    tags: ["Decisions", "You sign off"],
    background: "/marketing/services/strategy.webp",
    Illustration: ApproveIllustration,
  },
  {
    title: "Book",
    description:
      "Replies land in the shared inbox, Outreach proposes times, and you record the meeting you agreed.",
    tags: ["Inbox", "Outreach"],
    background: "/marketing/hero-landscape.png",
    Illustration: BookIllustration,
  },
] as const

export function HowItWorks() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="how-it-works">
      <MarketingSectionIntro
        description="Scout, Researcher, and Outreach do the legwork. You approve every word before it sends and record the meetings yourself."
        eyebrow="How it works"
        icon={PlayIcon}
        revealViewport={revealViewport}
        title="Your squad does the work. You make the calls."
      />
      <motion.div
        className="grid gap-5 md:grid-cols-2 xl:grid-cols-4"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {steps.map(
          ({ title, description, tags, background, Illustration }, index) => (
            <motion.div
              className="h-full min-w-0"
              key={title}
              variants={revealCardVariants}
            >
              <Card className="h-full gap-0 bg-popover pt-0 text-popover-foreground [--card-spacing:--spacing(7)]">
                <div
                  aria-hidden="true"
                  className="relative isolate flex aspect-[1.12] items-center justify-center overflow-hidden p-7"
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
                  <p className="text-sm text-muted-foreground">
                    <span className="sr-only">Step </span>
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <CardTitle>
                    <h3 className="text-2xl tracking-tight">{title}</h3>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="pt-3 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
                <CardFooter className="mt-auto flex-wrap gap-2 pt-6">
                  {tags.map((tag) => (
                    <span
                      className="inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-lg bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground"
                      key={tag}
                    >
                      {tag}
                    </span>
                  ))}
                </CardFooter>
              </Card>
            </motion.div>
          ),
        )}
      </motion.div>
    </MarketingSection>
  )
}
