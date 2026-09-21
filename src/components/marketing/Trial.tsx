import {
  ArrowUpRight01Icon,
  Coins01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** The trial credit prices, straight from the ledger the app charges against. */
const prices = [
  { action: "Find leads — one page of results, up to 25 people", cost: "2" },
  { action: "Research and score one lead", cost: "3" },
  { action: "Find a lead's email address", cost: "15" },
  { action: "Write an email or a follow-up", cost: "1" },
  { action: "Read a reply and draft the answer", cost: "1" },
  { action: "Re-run a setup step, or ask for more keywords", cost: "3" },
] as const

/** Everything that costs nothing, so the app stays usable at a zero balance. */
const free = [
  "The whole first pass of setup",
  "Match counts, before you run a search",
  "Browsing, sorting and filtering your leads",
  "Approving and rejecting",
  "Sending, following up and handling opt-outs",
] as const

export function Trial() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="trial">
      <MarketingSectionIntro
        description="One plan. No card, no upgrade, no bill."
        eyebrow="Trial"
        icon={Coins01Icon}
        revealViewport={revealViewport}
        title="300 credits when you start."
      />
      <motion.div
        className="grid items-stretch gap-5 lg:grid-cols-[1.4fr_1fr]"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        <motion.div className="h-full min-w-0" variants={revealItemVariants}>
          <Card className="h-full rounded-4xl">
            <CardHeader>
              {/* One wrapper so the rows below set their own rhythm with margins. */}
              <div>
                <CardTitle>
                  <h3 className="text-xl font-medium tracking-tight">
                    What a credit buys
                  </h3>
                </CardTitle>
                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="font-display text-5xl leading-none tracking-tight">
                    300
                  </span>
                  <span className="text-sm text-muted-foreground">
                    credits to start
                  </span>
                </div>
                <p className="mt-4 max-w-xs text-base leading-relaxed text-muted-foreground">
                  Only the steps that cost us money cost you any.
                </p>
              </div>
            </CardHeader>
            <CardContent className="mt-6 mb-5">
              <dl className="flex flex-col">
                {prices.map(({ action, cost }) => (
                  <div
                    className="flex items-baseline justify-between gap-4 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
                    key={action}
                  >
                    <dt className="min-w-0 text-sm leading-relaxed">
                      {action}
                    </dt>
                    <dd className="shrink-0 font-display text-lg tracking-tight">
                      {cost}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="pt-5 text-sm leading-relaxed text-muted-foreground">
                Run out and the paid steps stop and say so. Everything free
                keeps working, mail still arrives, and opt-outs are still
                honoured.
              </p>
            </CardContent>
          </Card>
        </motion.div>
        <motion.div className="h-full min-w-0" variants={revealItemVariants}>
          <Card className="h-full rounded-4xl">
            <CardHeader>
              <CardTitle>
                <h3 className="text-xl font-medium tracking-tight">
                  Free, always
                </h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="mt-6 mb-5">
              <p className="text-base font-medium">Includes:</p>
              <ul className="mt-3 flex flex-col gap-3">
                {free.map((item) => (
                  <li className="flex items-start gap-3 text-base" key={item}>
                    <HugeiconsIcon
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0"
                      icon={Tick02Icon}
                      strokeWidth={1.75}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto">
              <Button
                className="w-full"
                nativeButton={false}
                render={<Link to="/sign-in" />}
                size="cta"
              >
                Start with 300 credits
                <HugeiconsIcon
                  aria-hidden="true"
                  data-icon="inline-end"
                  icon={ArrowUpRight01Icon}
                />
              </Button>
            </CardFooter>
          </Card>
        </motion.div>
      </motion.div>
    </MarketingSection>
  )
}
