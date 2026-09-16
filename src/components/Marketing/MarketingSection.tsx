import type { IconSvgElement } from "@hugeicons/react"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { MarketingChip } from "@/components/Marketing/MarketingChip"
import {
  revealContainerVariants,
  revealItemVariants,
  type RevealViewport,
} from "@/components/Marketing/motion-variants"

export function MarketingSection({
  children,
  id,
}: {
  children: ReactNode
  id?: string
}) {
  return (
    <section
      className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8"
      id={id}
    >
      {children}
    </section>
  )
}

/**
 * The shared section header: eyebrow chip, display headline, one-line
 * description, then any extra content such as a call to action.
 *
 * Every marketing section opens with this so the chip, headline size, and
 * vertical rhythm match from "How it works" down to the FAQ. `spacing="none"`
 * drops the bottom margin for layouts that place the header beside the
 * content instead of above it.
 */
export function MarketingSectionIntro({
  children,
  description,
  eyebrow,
  icon,
  revealViewport,
  spacing = "section",
  title,
}: {
  children?: ReactNode
  description: ReactNode
  eyebrow: string
  icon: IconSvgElement
  revealViewport: RevealViewport
  spacing?: "section" | "none"
  title: ReactNode
}) {
  return (
    <motion.div
      className={
        spacing === "none"
          ? "flex w-full flex-col items-start gap-4 text-left"
          : "mb-12 flex w-full flex-col items-start gap-4 text-left sm:mb-16"
      }
      initial="initial"
      variants={revealContainerVariants}
      viewport={revealViewport}
      whileInView="animate"
    >
      <motion.div className="mb-1" variants={revealItemVariants}>
        <MarketingChip icon={icon} label={eyebrow} />
      </motion.div>
      <motion.h2
        className="max-w-3xl display-xs font-bold tracking-tight text-balance sm:display-md"
        variants={revealItemVariants}
      >
        {title}
      </motion.h2>
      <motion.p
        className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg"
        variants={revealItemVariants}
      >
        {description}
      </motion.p>
      {children}
    </motion.div>
  )
}
