import { HelpCircleIcon, Mail01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
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

/**
 * The support address. The footer carries no contact email (only an X
 * link), so the documented fallback stands in here too.
 */
const SUPPORT_EMAIL = "support@openintent.ai"

/**
 * Copies the support address instead of opening a mail client. The icon
 * flips to a tick for a moment so the click has visible feedback; when
 * the clipboard is unavailable the address itself is shown as fallback
 * text so it can still be copied by hand.
 */
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
            description="Short answers to the things people ask before they sign up."
            eyebrow="FAQ"
            icon={HelpCircleIcon}
            revealViewport={revealViewport}
            spacing="none"
            title="Common questions"
          >
            <motion.div
              className="mt-2 flex flex-col items-start gap-3"
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
          {/*
            The UI accordion is a bordered, divided list; the marketing FAQ is
            a single column of separate raised tiles with generous spacing, so
            the root drops its border and each item paints its own surface.
            Base UI opens one item at a time by default.
          */}
          <Accordion className="flex w-full flex-col gap-4 overflow-visible rounded-none border-0">
            {faqItems.map((item) => (
              <motion.div
                className="min-w-0"
                key={item.title}
                variants={revealItemVariants}
              >
                <AccordionItem
                  className="overflow-hidden rounded-2xl border bg-card text-card-foreground data-open:bg-card"
                  value={item.title}
                >
                  <AccordionTrigger className="items-center gap-4 px-5 py-4 hover:no-underline sm:px-6 sm:py-5">
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
