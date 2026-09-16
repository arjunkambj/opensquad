import {
  AiBrain01Icon,
  CommandLineIcon,
  Database01Icon,
  FireIcon,
  Mail01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { motion } from "motion/react"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"

const groups: readonly {
  name: string
  items: readonly { name: string; icon: IconSvgElement }[]
}[] = [
  {
    name: "Your agents run on",
    items: [
      { name: "Codex", icon: CommandLineIcon },
      { name: "OpenAI", icon: AiBrain01Icon },
    ],
  },
  {
    name: "Built on",
    items: [
      { name: "Convex", icon: Database01Icon },
      { name: "AgentMail", icon: Mail01Icon },
      { name: "Firecrawl", icon: FireIcon },
    ],
  },
]

/** The stack OpenSquad runs on, in place of a logo wall. */
export function WorksWith() {
  const revealViewport = useRevealViewport()

  return (
    <section
      aria-label="Works with"
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 sm:px-6 lg:px-8"
      id="works-with"
    >
      <motion.div
        className="grid gap-10 md:grid-cols-[1fr_1.6fr] md:gap-0"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {groups.map((group) => (
          <motion.div
            className="flex min-w-0 flex-col gap-5 border-b border-border pb-10 last:border-0 last:pb-0 md:border-r md:border-b-0 md:px-6 md:pb-0 md:first:pl-0 md:last:pr-0 lg:px-8"
            key={group.name}
            variants={revealItemVariants}
          >
            <h2 className="text-xs font-semibold tracking-eyebrow text-muted-foreground uppercase">
              {group.name}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {group.items.map((item) => (
                <li key={item.name}>
                  <span className="inline-flex h-auto w-fit shrink-0 items-center justify-center gap-2 overflow-hidden rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium whitespace-nowrap text-secondary-foreground">
                    <HugeiconsIcon
                      aria-hidden="true"
                      className="size-4"
                      icon={item.icon}
                      strokeWidth={1.75}
                    />
                    {item.name}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
