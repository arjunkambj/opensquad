import { Mail01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { faqItems } from "@/components/marketing/faq-items"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

const SUPPORT_EMAIL = "support@openintent.ai"

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  if (failed) {
    return <p className="text-sm text-muted-foreground">Email us at {email}</p>
  }

  return (
    <Button onClick={copyEmail} size="cta" title={email} type="button">
      <HugeiconsIcon
        aria-hidden="true"
        data-icon="inline-start"
        icon={copied ? Tick02Icon : Mail01Icon}
      />
      {copied ? "Email copied" : "Copy our email"}
    </Button>
  )
}

export function FAQ() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="faq">
      <div className="grid items-start gap-12 xl:grid-cols-[1fr_1.35fr] xl:gap-16">
        <div className="xl:sticky xl:top-40">
          <MarketingSectionIntro
            eyebrow="FAQ"
            revealViewport={revealViewport}
            spacing="none"
            title="Common questions"
          >
            <motion.div
              className="mt-2 flex flex-col items-start gap-4"
              variants={revealItemVariants}
            >
              <p className="text-sm text-muted-foreground">
                Need more help? Email us and we will get back to you.
              </p>
              <CopyEmailButton email={SUPPORT_EMAIL} />
            </motion.div>
          </MarketingSectionIntro>
        </div>
        <motion.div
          className="min-w-0"
          initial="initial"
          variants={revealContainerVariants}
          viewport={revealViewport}
          whileInView="animate"
        >
          <Accordion className="overflow-visible">
            {faqItems.map((item) => (
              <motion.div
                className="min-w-0 overflow-hidden rounded-2xl bg-card text-card-foreground not-last:mb-4"
                key={item.title}
                variants={revealItemVariants}
              >
                <AccordionItem value={item.title}>
                  {/* Margin tops up the trigger's p-4. */}
                  <AccordionTrigger variant="plain" className="mx-1 sm:mx-2 sm:my-1">
                    <span className="text-base leading-snug font-medium sm:text-lg">
                      {item.title}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-1 pb-5 sm:px-2">
                    <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {item.content}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </MarketingSection>
  )
}
