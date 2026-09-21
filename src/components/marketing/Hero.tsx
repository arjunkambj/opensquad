import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"
import { HeroLeadSketch } from "@/components/marketing/HeroLeadSketch"
import { MarketingChip } from "@/components/marketing/MarketingChip"
import { Button } from "@/components/ui/button"

/**
 * What someone actually needs before the agent can start. No vendor is named
 * here: which lead-data, research or model service we buy is ours to change
 * and never client-visible (PLAN §4 "White-label rule").
 */
const startingPoints = [
  "Your website",
  "300 credits, no card",
  "Your own inbox, when you want it sending",
] as const

export function Hero() {
  const reduceMotion = useReducedMotion()
  const heroItemVariants = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 16 },
    animate: (step: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: reduceMotion ? 0 : step * 0.08,
        duration: reduceMotion ? 0 : 0.5,
        ease: "easeOut" as const,
      },
    }),
  }

  return (
    <motion.section
      animate="animate"
      className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pt-14 sm:gap-12 sm:px-6 sm:pt-18 lg:px-8 lg:pt-20"
      id="hero"
      initial="initial"
    >
      <div className="flex w-full flex-col gap-3.5">
        <motion.div
          className="mb-3.5 w-fit"
          custom={0}
          variants={heroItemVariants}
        >
          <MarketingChip
            icon="logo"
            label="Outbound that runs while you work"
          />
        </motion.div>
        <motion.h1
          className="max-w-4xl font-semibold display-xs tracking-tight sm:display-sm lg:display-lg 2xl:display-xl"
          custom={1}
          variants={heroItemVariants}
        >
          <span className="block">An AI sales agent that finds</span>
          <span className="block">your leads and emails them.</span>
        </motion.h1>
        <motion.div
          className="flex flex-col items-start gap-6"
          custom={2}
          variants={heroItemVariants}
        >
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
            Point it at your website once. It finds people on real buying
            signals, researches and scores them, sends a personal email from
            your own inbox, follows up twice, and works the reply until there
            is a meeting to book. Email only.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              aria-label="Get started with OpenIntent"
              nativeButton={false}
              render={<Link to="/sign-in" />}
              size="cta"
            >
              Get started
              <HugeiconsIcon
                aria-hidden="true"
                data-icon="inline-end"
                icon={ArrowUpRight01Icon}
              />
            </Button>
            <Button
              nativeButton={false}
              render={<a href="/#how-it-works" />}
              size="cta"
              variant="secondary"
            >
              See how it works
            </Button>
          </div>
        </motion.div>
        <motion.div
          className="mt-4 flex flex-col items-start gap-3"
          custom={3}
          variants={heroItemVariants}
        >
          <p className="text-sm text-muted-foreground">
            All it needs to start
          </p>
          <ul
            aria-label="What you need to start"
            className="flex flex-wrap gap-2"
          >
            {startingPoints.map((point) => (
              <li key={point}>
                <span className="inline-flex h-8 items-center rounded-lg bg-secondary px-3 text-xs font-medium text-secondary-foreground">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
      <motion.div custom={4} variants={heroItemVariants}>
        <div className="relative overflow-hidden rounded-2xl bg-accent px-3 pt-12 sm:h-[620px] sm:px-12 sm:pt-16 lg:h-[700px]">
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-right-bottom"
            decoding="async"
            loading="eager"
            src="/marketing/hero-landscape.png"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 rounded-xl border border-background/40"
          />
          <div className="relative rounded-t-marketing-preview bg-background/40 p-3 backdrop-blur-md">
            <HeroLeadSketch />
          </div>
        </div>
      </motion.div>
    </motion.section>
  )
}
