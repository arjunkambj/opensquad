import { motion } from "motion/react"
import type { ReactNode } from "react"
import {
  revealContainerVariants,
  revealItemVariants,
  type RevealViewport,
} from "@/components/marketing/motion-variants"
import { cn } from "@/lib/utils"

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
 * The shared section header: a plain-text eyebrow, a display headline, then
 * any extra content such as a call to action.
 *
 * Every marketing section opens with this so the eyebrow, headline size, and
 * vertical rhythm match from "How it works" down to the FAQ. `spacing="none"`
 * drops the bottom margin for layouts that place the header beside the
 * content instead of above it.
 */
export function MarketingSectionIntro({
  align = "start",
  children,
  eyebrow,
  revealViewport,
  spacing = "section",
  title,
}: {
  align?: "start" | "center"
  children?: ReactNode
  eyebrow: string
  revealViewport: RevealViewport
  spacing?: "section" | "none"
  title: ReactNode
}) {
  return (
    <motion.div
      className={cn(
        "flex w-full flex-col gap-4",
        align === "center"
          ? "items-center text-center"
          : "items-start text-left",
        spacing === "section" && "mb-12 sm:mb-16",
      )}
      initial="initial"
      variants={revealContainerVariants}
      viewport={revealViewport}
      whileInView="animate"
    >
      <motion.p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        variants={revealItemVariants}
      >
        <span aria-hidden="true" className="size-1.5 bg-illustration-accent" />
        {eyebrow}
      </motion.p>
      <motion.h2
        className="max-w-3xl text-balance font-bold display-xs tracking-tight sm:display-md"
        variants={revealItemVariants}
      >
        {title}
      </motion.h2>
      {children}
    </motion.div>
  )
}
