import { QuestionIcon } from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/Marketing/MarketingSection"
import {
  revealCardVariants,
  revealContainerVariants,
  useRevealViewport,
} from "@/components/Marketing/motion-variants"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { faqItems } from "@/constants/landing-page"

export function FAQ() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="faq">
      <MarketingSectionIntro
        description="Short answers on approvals, evidence, limits, and how the agents run."
        eyebrow="FAQ"
        icon={QuestionIcon}
        revealViewport={revealViewport}
        title={
          <>
            Questions agencies ask
            <br />
            <span className="text-muted-foreground">before signing up.</span>
          </>
        }
      />
      <motion.div
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {/*
          The UI accordion is a bordered, divided list; the marketing FAQ is a
          two-column grid of separate raised tiles, so the root drops its
          border and each item paints its own surface.
        */}
        <Accordion className="grid items-start gap-4 overflow-visible rounded-none border-0 md:grid-cols-2">
          {faqItems.map((item) => (
            <motion.div
              className="min-w-0"
              key={item.title}
              variants={revealCardVariants}
            >
              <AccordionItem
                className="overflow-hidden rounded-2xl border-0 bg-popover text-popover-foreground data-open:bg-popover"
                value={item.title}
              >
                <AccordionTrigger className="items-center gap-4 px-5 py-4 hover:no-underline sm:px-6 sm:py-5">
                  <span className="text-base leading-snug font-medium sm:text-lg">
                    {item.title}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-1 pb-5 sm:px-2">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.content}
                  </p>
                </AccordionContent>
              </AccordionItem>
            </motion.div>
          ))}
        </Accordion>
      </motion.div>
    </MarketingSection>
  )
}
