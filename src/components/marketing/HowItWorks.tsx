import { Route01Icon } from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import { stages } from "@/components/marketing/stages"
import {
  revealCardVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * The five stages of the loop, each split into what you do, what the agent
 * does and what it costs — the same split the app enforces, so nothing here
 * promises work the agent is not allowed to do on its own.
 */
export function HowItWorks() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="how-it-works">
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.6fr] lg:gap-16">
        <div className="lg:sticky lg:top-40">
          <MarketingSectionIntro
            description="Set it up once. After that it runs on its own schedule, and stops wherever you told it to wait for you."
            eyebrow="How it works"
            icon={Route01Icon}
            revealViewport={revealViewport}
            spacing="none"
            title="Five stages, start to meeting."
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5 md:gap-6">
          {stages.map(({ title, description, you, agent, cost }, index) => (
            <motion.div
              initial="initial"
              key={title}
              variants={revealCardVariants}
              viewport={revealViewport}
              whileInView="animate"
            >
              <Card className="gap-6 rounded-4xl [--card-spacing:--spacing(7)] sm:[--card-spacing:--spacing(9)]">
                <CardHeader className="gap-2">
                  <p className="text-sm text-muted-foreground">
                    <span className="sr-only">Stage </span>
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <CardTitle>
                    <h3 className="text-2xl leading-tight tracking-tight sm:text-3xl">
                      {title}
                    </h3>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {description}
                  </p>
                  <dl className="grid gap-3 rounded-2xl bg-muted p-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs font-semibold tracking-eyebrow text-muted-foreground uppercase">
                        You
                      </dt>
                      <dd className="text-sm leading-relaxed">{you}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs font-semibold tracking-eyebrow text-muted-foreground uppercase">
                        The agent
                      </dt>
                      <dd className="text-sm leading-relaxed">{agent}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">{cost}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </MarketingSection>
  )
}
