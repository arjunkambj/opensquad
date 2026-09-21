import {
  AudioLinesIcon,
  InboxIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import { Chip } from "@/components/kit/Chip"
import { DetailRow } from "@/components/kit/DetailRow"
import { FramedPanel } from "@/components/kit/FramedPanel"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import {
  AppPreview,
  PreviewMat,
  PreviewRow,
} from "@/components/marketing/preview/AppPreview"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import { Switch } from "@/components/ui/switch"

/** The copy says it learns who buys; this shows the buyer it drew up. */
function ProfileIllustration() {
  return (
    <FramedPanel
      as="div"
      icon={Target02Icon}
      title="Who to reach"
      action={<Chip>yourcompany.com</Chip>}
      bodyClassName="gap-3"
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip variant="accent">VP Marketing</Chip>
        <Chip variant="accent">Head of Growth</Chip>
        <Chip variant="accent">Founder</Chip>
      </div>
      <DetailRow label="Company" value="SaaS, 50 to 500 people" />
      <DetailRow label="Where" value="US, UK, Canada" />
    </FramedPanel>
  )
}

const signals = [
  { title: "Hiring marketers", why: "Teams you sell to are growing", on: true },
  { title: "Recently funded", why: "New budget to spend", on: true },
  { title: "Growing headcount", why: "Hiring fast, no new roles yet", on: false },
] as const

/** The copy says pick; this shows it proposes them, each with a reason. */
function SignalsIllustration() {
  return (
    <FramedPanel
      as="div"
      icon={AudioLinesIcon}
      title="Suggested for you"
      bodyClassName="p-0 py-1"
    >
      <ul className="flex flex-col">
        {signals.map((signal) => (
          <PreviewRow
            key={signal.title}
            detail={signal.why}
            end={<Switch defaultChecked={signal.on} />}
            title={signal.title}
          />
        ))}
      </ul>
    </FramedPanel>
  )
}

const thread = [
  { title: "First email", detail: "Mon · from you@yourcompany.com", label: "Sent", variant: "muted" },
  { title: "Nudge", detail: "Thu · no reply yet", label: "Sent", variant: "muted" },
  { title: "Reply", detail: "Fri · lands in your inbox", label: "Interested", variant: "accent" },
] as const

/** The copy stops at "until they reply"; this shows the reply arriving. */
function ApproveIllustration() {
  return (
    <FramedPanel
      as="div"
      icon={InboxIcon}
      title="VP Marketing"
      bodyClassName="p-0 py-1"
    >
      <ul className="flex flex-col">
        {thread.map((item) => (
          <PreviewRow
            key={item.title}
            detail={item.detail}
            end={<Chip variant={item.variant}>{item.label}</Chip>}
            title={item.title}
          />
        ))}
      </ul>
    </FramedPanel>
  )
}

const steps = [
  {
    title: "Add your website",
    description:
      "It learns what you sell and who buys it. Fix anything it got wrong.",
    background: "/marketing/backgrounds/forest-peach-lake.webp",
    backgroundPosition: "object-center",
    Illustration: ProfileIllustration,
  },
  {
    title: "Pick the signals",
    description:
      "Choose what makes someone worth contacting. See how many match before you spend a credit.",
    background: "/marketing/backgrounds/forest-peach-path.webp",
    backgroundPosition: "object-center",
    Illustration: SignalsIllustration,
  },
  {
    title: "Approve and send",
    description:
      "Approve the lead, then the email. It follows up until they reply.",
    background: "/marketing/backgrounds/forest-peach-overlook.webp",
    backgroundPosition: "object-center",
    Illustration: ApproveIllustration,
  },
] as const

export function HowItWorks() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="how-it-works">
      <MarketingSectionIntro
        eyebrow="How it works"
        revealViewport={revealViewport}
        title="Get started in three steps"
      />
      <motion.div
        className="grid gap-x-6 gap-y-12 lg:grid-cols-3"
        initial="initial"
        variants={revealContainerVariants}
        viewport={revealViewport}
        whileInView="animate"
      >
        {steps.map(
          (
            { title, description, background, backgroundPosition, Illustration },
            index,
          ) => (
            <motion.div
              className="flex min-w-0 flex-col gap-6"
              key={title}
              variants={revealItemVariants}
            >
              <div
                aria-hidden="true"
                className="relative isolate flex aspect-square items-center justify-center overflow-hidden rounded-marketing-panel bg-section-accent p-6 sm:p-10 lg:p-6 xl:p-8"
              >
                <img
                  alt=""
                  className={`absolute inset-0 -z-10 size-full object-cover ${backgroundPosition}`}
                  decoding="async"
                  loading="lazy"
                  src={background}
                />
                <PreviewMat className="w-full max-w-80">
                  <AppPreview>
                    <Illustration />
                  </AppPreview>
                </PreviewMat>
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="text-2xl tracking-tight">
                  <span className="sr-only">Step {index + 1}: </span>
                  {title}
                </h3>
                <p className="text-base leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </motion.div>
          ),
        )}
      </motion.div>
    </MarketingSection>
  )
}
