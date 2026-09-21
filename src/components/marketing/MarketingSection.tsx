import type { IconSvgElement } from "@hugeicons/react"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { MarketingChip } from "@/components/marketing/MarketingChip"
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

export function MarketingSectionIntro({
  align = "start",
  children,
  description,
  eyebrow,
  icon,
  revealViewport,
  spacing = "section",
  title,
}: {
  align?: "start" | "center"
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
      className={cn(
        "flex w-full flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start text-left",
        spacing === "none" ? undefined : "mb-12 sm:mb-16",
      )}
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
        className={cn(
          "max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg",
          align === "center" && "text-center",
        )}
        variants={revealItemVariants}
      >
        {description}
      </motion.p>
      {children}
    </motion.div>
  )
}
