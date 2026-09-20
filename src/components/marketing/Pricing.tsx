import { Tag01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
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
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { pricingPlans, type PricingPlan } from "@/constants/landing-page"

export function Pricing() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="pricing">
      <MarketingSectionIntro
        description="Every plan runs from your inbox with five companies per campaign."
        eyebrow="Pricing"
        icon={Tag01Icon}
        revealViewport={revealViewport}
        title="Simple pricing."
      />
      <motion.div
        className="grid items-stretch gap-5 lg:grid-cols-3"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {pricingPlans.map((plan) => (
          <motion.div
            className="h-full min-w-0"
            key={plan.key}
            variants={revealCardVariants}
          >
            <PricingCard plan={plan} />
          </motion.div>
        ))}
      </motion.div>
    </MarketingSection>
  )
}

function PricingCard({ plan }: { plan: PricingPlan }) {
  return (
    <Card className="relative isolate h-full gap-5 rounded-4xl bg-popover text-popover-foreground [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(7)]">
      {plan.isPopular && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-4xl"
        >
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-right-bottom opacity-65 [mask-image:linear-gradient(110deg,transparent_40%,black_100%)]"
            decoding="async"
            loading="lazy"
            src="/marketing/pricing-creators.webp"
          />
        </div>
      )}
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-3">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <CardTitle>
              <h3 className="text-xl tracking-tight">{plan.name}</h3>
            </CardTitle>
            {plan.isPopular && (
              <span className="inline-flex h-7 w-fit shrink-0 items-center justify-center rounded-lg bg-primary px-3 py-1 text-xs font-medium whitespace-nowrap text-primary-foreground">
                Popular
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-5xl leading-none tracking-display sm:text-6xl">
              {plan.priceAmount === null
                ? plan.priceLabel
                : `$${plan.priceAmount}`}
            </span>
            {plan.periodLabel && (
              <span className="text-base text-muted-foreground">
                {plan.periodLabel}
              </span>
            )}
          </div>
        </div>
        <p className="max-w-xs pt-2 text-sm leading-relaxed text-muted-foreground lg:min-h-10">
          {plan.description}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Includes:</p>
          <ul className="flex flex-col gap-2.5">
            {plan.features.map((feature) => (
              <li
                className="flex items-start gap-3 text-sm leading-relaxed"
                key={feature}
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                  icon={Tick02Icon}
                  strokeWidth={1.75}
                />
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardFooter className="mt-auto pt-3">
        <Button
          className={
            plan.isPopular
              ? "w-full"
              : "w-full border-border bg-background text-foreground shadow-[0_1px_1px_rgba(0,0,0,0.03),0_4px_12px_-6px_rgba(0,0,0,0.06)] hover:bg-background hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-6px_rgba(0,0,0,0.08)]"
          }
          nativeButton={false}
          render={<Link to="/sign-in" />}
          size="cta"
          variant={plan.isPopular ? "default" : "outline"}
        >
          {plan.ctaLabel}
        </Button>
      </CardFooter>
    </Card>
  )
}
