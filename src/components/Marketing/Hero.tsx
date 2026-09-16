import {
  ArrowUpRight01Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"
import { HeroApprovalPreview } from "@/components/Marketing/HeroApprovalPreview"
import { MarketingChip } from "@/components/Marketing/MarketingChip"
import { Button } from "@/components/ui/button"

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
            icon={UserCheck01Icon}
            label="Every email approved by a human"
          />
        </motion.div>
        <motion.h1
          className="max-w-4xl font-semibold display-xs tracking-tight sm:display-sm lg:display-lg 2xl:display-xl"
          custom={1}
          variants={heroItemVariants}
        >
          <span className="flex flex-wrap items-center gap-x-word gap-y-line">
            Your
            <span className="inline-flex items-center gap-glyph">
              <svg
                aria-hidden="true"
                className="size-[0.8em] shrink-0 -rotate-3"
                fill="none"
                viewBox="0 0 64 64"
              >
                <circle
                  cx="22"
                  cy="24"
                  r="8"
                  stroke="currentColor"
                  strokeWidth="6"
                />
                <circle
                  cx="42"
                  cy="24"
                  r="8"
                  stroke="currentColor"
                  strokeWidth="6"
                />
                <circle
                  cx="32"
                  cy="42"
                  r="8"
                  stroke="currentColor"
                  strokeWidth="6"
                />
              </svg>
              AI
            </span>
            Sales Squad
          </span>
          <span className="block">You Approve Every Word</span>
        </motion.h1>
        <motion.div
          className="flex flex-col items-start gap-6"
          custom={2}
          variants={heroItemVariants}
        >
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Scout finds companies, Researcher backs every opportunity with
            sources, and Outreach drafts the exact email. Nothing sends until
            you approve it.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              aria-label="Start OpenSquad for free"
              nativeButton={false}
              render={<Link to="/sign-in" />}
              size="cta"
            >
              Start For Free
              <HugeiconsIcon
                aria-hidden="true"
                data-icon="inline-end"
                icon={ArrowUpRight01Icon}
              />
            </Button>
            <Button
              nativeButton={false}
              render={<a href="#how-it-works" />}
              size="cta"
              variant="outline"
            >
              See how it works
            </Button>
          </div>
        </motion.div>
      </div>
      <motion.div custom={3} variants={heroItemVariants}>
        <div className="relative overflow-hidden rounded-2xl bg-accent px-3 pt-12 sm:h-[560px] sm:px-12 sm:pt-16 lg:h-[640px]">
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
            <HeroApprovalPreview />
          </div>
        </div>
      </motion.div>
    </motion.section>
  )
}
