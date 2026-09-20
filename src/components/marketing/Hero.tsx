import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"
import { HeroApprovalPreview } from "@/components/marketing/HeroApprovalPreview"
import { MarketingChip } from "@/components/marketing/MarketingChip"
import { Button } from "@/components/ui/button"

/** The model provider the agent's writing runs on. */
const providers = [
  { name: "OpenAI", logo: "/marketing/logos/openai.svg" },
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
          <span className="block">Your AI Sales Squad</span>
          <span className="block">Does the research, finds the leads, books the calls.</span>
        </motion.h1>
        <motion.div
          className="flex flex-col items-start gap-6"
          custom={2}
          variants={heroItemVariants}
        >
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Give it a campaign. Scout finds the companies, Researcher reads up
            on them, and Outreach writes and sends the emails from your inbox.
            Replies come back to one place.
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
              render={<a href="#how-it-works" />}
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
            Runs on OpenAI models
          </p>
          <ul aria-label="Providers" className="flex flex-wrap gap-2">
            {providers.map((provider) => (
              <li key={provider.name}>
                <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-secondary px-3 text-xs font-medium text-secondary-foreground">
                  <img
                    alt=""
                    className="size-4"
                    decoding="async"
                    src={provider.logo}
                  />
                  {provider.name}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
      <motion.div custom={4} variants={heroItemVariants}>
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
