import { Route01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "motion/react"
import {
  MarketingSection,
  MarketingSectionIntro,
} from "@/components/marketing/MarketingSection"
import {
  revealContainerVariants,
  revealItemVariants,
  useRevealViewport,
} from "@/components/marketing/motion-variants"
import { cn } from "@/lib/utils"

function ProfileIllustration() {
  return (
    <div className="w-full rounded-xl bg-illustration px-5 pt-4 pb-3.5 shadow-xl shadow-foreground/10">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Company profile
      </p>
      <div className="mt-3.5 flex flex-col gap-2">
        {[
          { label: "Sells to", value: "Mid-size SaaS teams" },
          { label: "Solves", value: "Hiring without buying lists" },
          { label: "Sounds like", value: "Plain, short emails" },
        ].map(({ label, value }) => (
          <div className="flex items-center gap-3" key={label}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{value}</p>
              <p className="truncate text-xs text-muted-foreground">{label}</p>
            </div>
            <HugeiconsIcon
              className="ml-auto size-4 shrink-0"
              icon={Tick02Icon}
            />
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Fix what it misread, then continue.
      </p>
    </div>
  )
}

function SignalsIllustration() {
  return (
    <div className="w-full rounded-xl bg-illustration px-5 pt-4 pb-3.5 shadow-xl shadow-foreground/5">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Pick the signals
      </p>
      <p className="mt-3.5 rounded-lg bg-card px-3 py-2.5 text-xs">
        Which teams are hiring marketers right now?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {["Hiring · 180", "Funded · 96", "Headcount · 240"].map(
          (pill, index) => (
            <span
              className={cn(
                "rounded-lg px-2.5 py-2 text-xs",
                index === 0
                  ? "bg-foreground text-background"
                  : "bg-card text-foreground",
              )}
              key={pill}
            >
              {pill}
            </span>
          ),
        )}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Counts are free. A search costs 2 credits a page.
      </p>
    </div>
  )
}

function ApproveIllustration() {
  return (
    <div className="w-full rounded-xl bg-illustration px-5 pt-4 pb-3.5 shadow-xl shadow-foreground/20">
      <p className="text-xs tracking-widest text-muted-foreground uppercase">
        Approve, then it sends
      </p>
      <div className="mt-3.5 flex flex-col gap-2">
        {[
          { label: "A lead worth an email", action: "Approve" },
          { label: "First email draft", action: "Send" },
        ].map(({ label, action }) => (
          <div
            className="flex items-center gap-3 rounded-lg bg-card px-3 py-2.5"
            key={label}
          >
            <p className="min-w-0 truncate text-xs">{label}</p>
            <span className="ml-auto shrink-0 rounded-full bg-foreground px-3 py-1 text-xs text-background">
              {action}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        It follows up until someone replies.
      </p>
    </div>
  )
}

const steps = [
  {
    title: "Paste your website",
    description:
      "It reads your site and drafts who you sell to. You fix what it misread.",
    background: "/marketing/backgrounds/forest-peach-lake.webp",
    backgroundPosition: "object-center",
    Illustration: ProfileIllustration,
  },
  {
    title: "Pick the signals",
    description:
      "Choose the buying signals worth watching. Match counts are free.",
    background: "/marketing/backgrounds/forest-peach-path.webp",
    backgroundPosition: "object-center",
    Illustration: SignalsIllustration,
  },
  {
    title: "Approve, then it sends",
    description:
      "Say yes to the lead and the email. It follows up until someone replies.",
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
        description="Paste your site, pick your signals, approve the sends — three steps and it's working."
        eyebrow="How it works"
        icon={Route01Icon}
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
              className="flex min-w-0 flex-col gap-5"
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
                <div className="w-full max-w-80 rounded-2xl bg-illustration/40 p-1.5 shadow-xl shadow-foreground/10 backdrop-blur-sm">
                  <Illustration />
                </div>
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
