import {
  FilterHorizontalIcon,
  MailOpen01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import { DetailRow } from "@/components/kit/DetailRow"
import { FlameScore } from "@/components/kit/FlameScore"
import { FramedPanel } from "@/components/kit/FramedPanel"
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
  AppPreview,
  PreviewMat,
  PreviewRow,
} from "@/components/marketing/preview/AppPreview"
import { cn } from "@/lib/utils"

const funnel = [
  { label: "Showed a buying signal", value: 180, bar: "w-full bg-chart-3" },
  { label: "Fit who you sell to", value: 25, bar: "w-[14%] bg-chart-1" },
] as const

/** The copy says it keeps only the fits; this shows how few that is. */
function FindingMockup() {
  return (
    <FramedPanel
      as="div"
      icon={FilterHorizontalIcon}
      title="This week's search"
      bodyClassName="gap-4"
    >
      {funnel.map((step) => (
        <div key={step.label} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">{step.label}</span>
            <span className="font-display text-2xl font-semibold tabular-nums">
              {step.value}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className={cn("h-full rounded-full", step.bar)} />
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        155 skipped: wrong size, industry or country.
      </p>
    </FramedPanel>
  )
}

const sources = [
  { title: "Careers page", detail: "Three open marketing roles" },
  { title: "Press release", detail: "Series A, announced in June" },
  { title: "Pricing page", detail: "Sells to mid-size teams" },
] as const

/** The copy says it writes a note; this shows what the note stands on. */
function ResearchMockup() {
  return (
    <FramedPanel
      as="div"
      icon={StarIcon}
      title="Why VP Marketing"
      action={<FlameScore score={3} status="researched" />}
      bodyClassName="p-0 py-1"
    >
      <ul className="flex flex-col">
        {sources.map((source) => (
          <PreviewRow
            key={source.title}
            detail={source.detail}
            title={source.title}
          />
        ))}
      </ul>
    </FramedPanel>
  )
}

/** The copy says "from your inbox"; this is the email as they receive it. */
function SendingMockup() {
  return (
    <FramedPanel
      as="div"
      icon={MailOpen01Icon}
      title="Congrats on the Series A"
      bodyClassName="gap-3"
    >
      <div className="flex flex-col gap-1">
        <DetailRow label="From" value="you@yourcompany.com" />
        <DetailRow label="To" value="VP Marketing" />
      </div>
      <p className="text-sm leading-relaxed">
        Saw you are hiring three marketers after the raise. Teams at that
        stage usually…
      </p>
      <p className="text-xs text-muted-foreground">
        Don't want these emails? <span className="underline">Unsubscribe</span>
      </p>
    </FramedPanel>
  )
}

const features = [
  {
    eyebrow: "Finding",
    title: "Find leads on buying signals, not lists",
    description:
      "It looks for companies that just raised, are hiring, or are growing, and keeps only the ones that fit who you sell to.",
    background: "/marketing/backgrounds/forest-peach-ridge.webp",
    backgroundPosition: "object-[50%_70%]",
    tags: ["Funded", "Hiring", "Headcount", "Keywords"],
    Illustration: FindingMockup,
  },
  {
    eyebrow: "Research",
    title: "Know why each lead is worth an email",
    description:
      "It reads each company's website, writes a short note on why they might buy, and scores them from 1 to 3.",
    background: "/marketing/backgrounds/forest-peach-stream.webp",
    backgroundPosition: "object-[40%_65%]",
    tags: ["Notes", "Scores", "Signals"],
    Illustration: ResearchMockup,
  },
  {
    eyebrow: "Sending",
    title: "Emails from your inbox, with your approval",
    description:
      "Every email is written for one person. If they don't reply, it nudges them twice, then stops.",
    background: "/marketing/backgrounds/forest-peach-clearing.webp",
    backgroundPosition: "object-[65%_70%]",
    tags: ["Your inbox", "Your approval", "Two nudges", "Unsubscribe"],
    Illustration: SendingMockup,
  },
] as const

export function Features() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="features">
      <MarketingSectionIntro
        align="center"
        eyebrow="Features"
        revealViewport={revealViewport}
        title="What you can do with OpenIntent"
      />
      <div className="flex flex-col gap-20 lg:gap-32">
        {features.map(
          (
            {
              eyebrow,
              title,
              description,
              tags,
              background,
              backgroundPosition,
              Illustration,
            },
            index,
          ) => {
            const imageFirst = index % 2 === 0

            return (
              <motion.div
                className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16"
                initial="initial"
                key={title}
                variants={revealContainerVariants}
                viewport={revealViewport}
                whileInView="animate"
              >
                <motion.div
                  aria-hidden="true"
                  className={cn(
                    "relative isolate flex aspect-square items-center justify-center overflow-hidden rounded-marketing-panel p-8",
                    !imageFirst && "lg:order-last",
                  )}
                  variants={revealItemVariants}
                >
                  <img
                    alt=""
                    className={`absolute inset-0 -z-10 size-full object-cover ${backgroundPosition}`}
                    decoding="async"
                    loading="lazy"
                    src={background}
                  />
                  <PreviewMat className="w-full max-w-sm">
                    <AppPreview>
                      <Illustration />
                    </AppPreview>
                  </PreviewMat>
                </motion.div>
                <motion.div
                  className="flex flex-col items-start"
                  variants={revealItemVariants}
                >
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="size-1.5 bg-illustration-accent"
                    />
                    {eyebrow}
                  </p>
                  <h3 className="mt-4 max-w-md text-balance text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
                    {title}
                  </h3>
                  <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                    {description}
                  </p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <li
                        className="rounded-full bg-card px-3 py-1.5 text-sm"
                        key={tag}
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </motion.div>
            )
          },
        )}
      </div>
    </MarketingSection>
  )
}
