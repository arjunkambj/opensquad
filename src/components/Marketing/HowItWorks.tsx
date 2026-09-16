import { Route01Icon } from "@hugeicons/core-free-icons"
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
    title: "Define",
    description:
      "Say who you want: the kind of company, the role, the signal that makes them worth an email.",
    tags: ["Campaign", "You"],
    background: "/marketing/services/creators.webp",
    Illustration: DiscoverIllustration,
  },
  {
    title: "Research",
    description:
      "Researcher reads their website and writes it up, with links.",
    tags: ["Leads", "Researcher"],
    background: "/marketing/services/launch.webp",
    Illustration: ResearchIllustration,
  },
  {
    title: "Send",
    description:
      "Outreach writes the email. One tap from you and it goes out.",
    tags: ["Outreach", "Your OK"],
    background: "/marketing/services/strategy.webp",
    Illustration: ApproveIllustration,
  },
  {
    title: "Book",
    description:
      "Replies come back with a drafted answer and two times.",
    tags: ["Inbox", "Outreach"],
    background: "/marketing/hero-landscape.png",
    Illustration: BookIllustration,
  },
] as const

export function HowItWorks() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="how-it-works">
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.6fr] lg:gap-16">
        <div className="lg:sticky lg:top-40">
          <MarketingSectionIntro
            description="Give it a campaign. It takes it from there."
            eyebrow="How it works"
            icon={Route01Icon}
            revealViewport={revealViewport}
            spacing="none"
            title="Here is what happens."
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6 md:gap-20 lg:gap-28">
          {steps.map(
            ({ title, description, tags, background, Illustration }, index) => (
              <motion.div
                initial="initial"
                key={title}
                variants={revealCardVariants}
                viewport={revealViewport}
                whileInView="animate"
              >
                <Card className="grid gap-0 rounded-4xl bg-popover px-2 py-0 text-popover-foreground sm:grid-cols-2">
                  <div className="flex flex-col justify-center gap-5 px-2 py-8 sm:py-12">
                    <CardHeader className="gap-2 px-5">
                      <p className="text-sm text-muted-foreground">
                        <span className="sr-only">Step </span>
                        {String(index + 1).padStart(2, "0")}
                      </p>
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
                    <CardFooter className="flex-wrap gap-2 px-5">
                      {tags.map((tag) => (
                        <span
                          className="inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-lg bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground"
                          key={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </CardFooter>
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
