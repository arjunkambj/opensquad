import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { HeroShowcase } from "@/components/marketing/HeroShowcase"
import { MarketingChip } from "@/components/marketing/MarketingChip"
import {
  revealContainerVariants,
  revealItemVariants,
} from "@/components/marketing/motion-variants"
import { WorksWith } from "@/components/marketing/WorksWith"
import { Button } from "@/components/ui/button"

export function Hero() {
  return (
    <motion.section
      animate="animate"
      className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pt-14 sm:gap-12 sm:px-6 sm:pt-18 lg:px-8 lg:pt-20"
      id="hero"
      initial="initial"
      variants={revealContainerVariants}
    >
      <div className="flex w-full flex-col gap-3.5">
        <motion.div className="mb-3.5 w-fit" variants={revealItemVariants}>
          <MarketingChip
            icon="logo"
            label="Outbound that runs while you work"
          />
        </motion.div>
        <motion.h1
          className="max-w-4xl font-semibold display-xs tracking-tight sm:display-sm lg:display-lg 2xl:display-xl"
          variants={revealItemVariants}
        >
          <span className="block">An AI sales agent that finds</span>
          <span className="block">your leads and emails them.</span>
        </motion.h1>
        <motion.div
          className="flex flex-col items-start gap-6"
          variants={revealItemVariants}
        >
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Point it at your website. It finds people showing real buying
            signals and emails them from your own inbox — nothing goes out
            without your say-so. Email only.
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
      </div>
      <motion.div variants={revealItemVariants}>
        <WorksWith />
      </motion.div>
      <motion.div variants={revealItemVariants}>
        <HeroShowcase />
      </motion.div>
    </motion.section>
  )
}
