import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import { Button } from "@/components/ui/button"

/** Plain facts about what starting actually commits you to. */
const facts = [
  "300 credits, once. No card.",
  "Nothing is sent until you connect your own inbox.",
  "Review mode is the default: you approve every email.",
  "Every email carries an opt-out line.",
] as const

export function CTA() {
  const revealViewport = useRevealViewport()

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <motion.section
        className="grid overflow-hidden rounded-4xl bg-card text-card-foreground md:grid-cols-[1.1fr_1fr]"
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
            Give it your website and see who it finds.
          </motion.h2>
          <motion.p
            className="max-w-md text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg"
            variants={revealItemVariants}
          >
            Setup takes one URL. The first leads, with the reason each one
            matched, cost you nothing but a few of the credits you start with.
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
          className="relative isolate flex min-h-80 items-center justify-center overflow-hidden p-6 sm:p-10 md:min-h-[500px]"
          variants={revealItemVariants}
        >
          <img
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-10 size-full object-cover object-right-bottom"
            decoding="async"
            loading="lazy"
            src="/marketing/hero-landscape.png"
          />
          <ul className="flex w-full max-w-sm flex-col gap-2.5 rounded-2xl bg-illustration p-6 text-foreground">
            {facts.map((fact) => (
              <li
                className="rounded-xl bg-muted px-3.5 py-2.5 text-sm leading-relaxed"
                key={fact}
              >
                {fact}
              </li>
            ))}
          </ul>
        </motion.div>
      </motion.section>
    </div>
  )
}
