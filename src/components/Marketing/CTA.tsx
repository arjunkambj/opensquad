import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { CtaPreview } from "@/components/Marketing/CtaPreview"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"
import { Button } from "@/components/ui/button"

export function CTA() {
  const revealViewport = useRevealViewport()

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <motion.section
        className="grid overflow-hidden rounded-4xl bg-popover text-popover-foreground md:grid-cols-[1.1fr_1fr]"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        <div className="flex flex-col items-start justify-center gap-5 p-8 sm:p-14 lg:p-20 lg:py-24">
          <motion.p
            className="-mb-4 text-sm text-muted-foreground"
            variants={revealItemVariants}
          >
            Get started
          </motion.p>
          <motion.h2
            className="max-w-lg font-bold tracking-tight text-balance display-xs sm:display-sm lg:display-md"
            variants={revealItemVariants}
          >
            Give it one campaign and see.
          </motion.h2>
          <motion.p
            className="max-w-md text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg"
            variants={revealItemVariants}
          >
            Five companies per campaign, sent from your inbox.
          </motion.p>
          <motion.div className="mt-2" variants={revealItemVariants}>
            <Button
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
          </motion.div>
        </div>
        <motion.div
          aria-hidden="true"
          className="relative min-h-80 overflow-hidden md:min-h-[500px]"
          variants={revealItemVariants}
        >
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-right-bottom"
            decoding="async"
            loading="lazy"
            src="/marketing/hero-landscape.png"
          />
          <div className="absolute top-8 left-4 w-[calc(100%-1rem)] rounded-t-marketing-preview bg-background/40 p-3 backdrop-blur-md sm:top-20 sm:left-20 sm:w-[calc(100%+6rem)]">
            <CtaPreview />
          </div>
        </motion.div>
      </motion.section>
    </div>
  )
}
