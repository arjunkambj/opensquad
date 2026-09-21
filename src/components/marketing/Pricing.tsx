import {
  ArrowUpRight01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const SUPPORT_EMAIL = "support@openintent.ai"

type Plan = {
  name: string
  amount: string
  period: string
  description: string
  features: readonly string[]
  cta: ReactNode
  isPopular?: boolean
}

const PLANS: readonly Plan[] = [
  {
    name: "Free",
    amount: "$0",
    period: "to start",
    description: "For trying it out on real leads.",
    features: [
      "300 free credits, no card",
      "Find, research and email leads",
      "Review mode with two approvals",
      "Unsubscribe and blocklist on every send",
    ],
    cta: (
      <Button
        className="w-full"
        nativeButton={false}
        render={<Link to="/sign-in" />}
        size="cta"
        variant="surface"
      >
        Start for free
        <HugeiconsIcon
          aria-hidden="true"
          data-icon="inline-end"
          icon={ArrowUpRight01Icon}
        />
      </Button>
    ),
  },
  {
    name: "Paid",
    amount: "Soon",
    period: "per month",
    description: "For teams that run out of credits and want more.",
    features: [
      "Everything in Free",
      "More credits every month",
      "Same safety controls",
      "For higher sending volume",
    ],
    isPopular: true,
    cta: (
      <Button className="w-full" disabled size="cta" type="button">
        Coming soon
      </Button>
    ),
  },
  {
    name: "Custom",
    amount: "Custom",
    period: "fits your team",
    description: "For bigger volumes and a hand getting set up.",
    features: [
      "Everything in Paid",
      "Volume that fits your team",
      "Our help getting set up",
      "Talk to a person first",
    ],
    cta: (
      <Button
        className="w-full"
        nativeButton={false}
        render={<a href={`mailto:${SUPPORT_EMAIL}`} />}
        size="cta"
        variant="surface"
      >
        Contact us
        <HugeiconsIcon
          aria-hidden="true"
          data-icon="inline-end"
          icon={ArrowUpRight01Icon}
        />
      </Button>
    ),
  },
]

function PricingCard({ plan }: { plan: Plan }) {
  return (
    <div
      className="relative isolate flex h-full flex-col overflow-hidden rounded-4xl bg-card p-8 text-sm text-card-foreground sm:p-10"
      data-slot="card"
    >
      {plan.isPopular && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-4xl"
        >
          <img
            alt=""
            className="size-full object-cover object-right-bottom opacity-65 [mask-image:linear-gradient(110deg,transparent_40%,black_100%)]"
            decoding="async"
            loading="lazy"
            src="/marketing/backgrounds/forest-peach-clearing.webp"
          />
        </div>
      )}
      <div className="flex flex-col gap-4">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h3 className="font-heading text-xl font-medium tracking-tight">
            {plan.name}
          </h3>
          {plan.isPopular && <Badge size="md">Popular</Badge>}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-5xl leading-none tracking-tight">
            {plan.amount}
          </span>
          <span className="text-sm text-muted-foreground">{plan.period}</span>
        </div>
        <p className="max-w-xs text-base leading-relaxed text-muted-foreground">
          {plan.description}
        </p>
      </div>
      <div className="my-6 flex flex-col gap-3">
        <p className="text-base font-medium">Includes:</p>
        <ul className="flex flex-col gap-3">
          {plan.features.map((feature) => (
            <li className="flex items-start gap-3 text-base" key={feature}>
              <HugeiconsIcon
                aria-hidden="true"
                className="mt-1 size-4 shrink-0"
                icon={Tick02Icon}
                strokeWidth={1.75}
              />
              {feature}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto">{plan.cta}</div>
    </div>
  )
}

export function Pricing() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="pricing">
      <MarketingSectionIntro
        eyebrow="Pricing"
        revealViewport={revealViewport}
        title="Choose your plan"
      />
      <motion.div
        className="grid items-stretch gap-6 lg:grid-cols-3"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {PLANS.map((plan) => (
          <motion.div
            className="h-full min-w-0"
            key={plan.name}
            variants={revealItemVariants}
          >
            <PricingCard plan={plan} />
          </motion.div>
        ))}
      </motion.div>
    </MarketingSection>
  )
}
