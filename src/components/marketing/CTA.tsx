import { ArrowUpRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { LogoMark } from "@/components/layout/Logo"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import { Button } from "@/components/ui/button"

/**
 * Schematic emails waiting on a decision. Anonymous on purpose — roles and
 * company shapes, never a person anyone could look up — and decorative
 * (the panel is aria-hidden), so nothing here reads as a result we claim.
 */
const waitingEmails = [
  {
    subject: "Worth fifteen minutes next week?",
    to: "VP Marketing · recently funded",
  },
  {
    subject: "Following up on your hiring post",
    to: "Head of Sales · hiring SDRs",
  },
] as const

/**
 * The approval moment, sketched: the reader asks what goes out, the agent
 * answers with the emails it wrote, and everything waits on approval.
 * Static spans, not buttons — there is nothing to click in a preview.
 */
function ApprovalPreview() {
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-background text-foreground shadow-xl shadow-foreground/10 sm:min-h-[520px]">
      <div className="flex flex-col gap-4 p-3 sm:p-5">
        <div className="flex justify-end">
          <p className="max-w-xs rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
            What goes out today?
          </p>
        </div>

        <div className="flex items-start gap-3">
          <LogoMark className="mt-0.5 size-6" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-sm leading-relaxed">
              Two emails are written and waiting. Nothing sends until you
              approve the exact text.
            </p>
            <div className="flex flex-col gap-2">
              {waitingEmails.map((email) => (
                <div
                  className="flex flex-col gap-0.5 rounded-xl bg-card px-3 py-2.5"
                  key={email.subject}
                >
                  <p className="truncate text-sm font-medium">
                    {email.subject}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {email.to}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-3.5"
                  icon={Tick02Icon}
                />
                Approve and send
              </span>
              <span className="inline-flex h-7 items-center rounded-lg bg-secondary px-3 text-xs font-medium text-secondary-foreground">
                Not now
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                Awaiting your approval
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CTA() {
  const revealViewport = useRevealViewport()

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <motion.section
        className="grid overflow-hidden rounded-marketing-section bg-card text-card-foreground md:min-h-[28rem] md:grid-cols-[1.1fr_1fr]"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        <div className="flex flex-col items-start justify-center gap-5 p-8 sm:p-10 lg:p-14">
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
            Setup takes one URL. You start with 300 credits and no card, and
            the first leads — each with the reason it matched — cost you
            nothing but a few of them. It starts in Sourcing only, so nothing
            is sent until you connect your own inbox and pick how it sends.
            Every email carries an opt-out line.
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
          className="relative min-h-[27rem] overflow-hidden md:min-h-0"
          variants={revealItemVariants}
        >
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-bottom"
            decoding="async"
            loading="lazy"
            src="/marketing/backgrounds/forest-peach.webp"
          />
          <div className="absolute top-10 left-10 w-[calc(100%+6rem)] rounded-t-marketing-preview bg-background/40 p-3 backdrop-blur-md sm:top-12 sm:left-14">
            <ApprovalPreview />
          </div>
        </motion.div>
      </motion.section>
    </div>
  )
}
