import { Layers01Icon } from "@hugeicons/core-free-icons"
import { motion } from "motion/react"
import { LogoMark } from "@/components/layout/Logo"
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

/** The reader's question, styled like the prompt in an AI chat. */
function Prompt({ children }: { children: React.ReactNode }) {
  return (
    <p className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-foreground px-3.5 py-2.5 text-sm leading-snug text-background">
      {children}
    </p>
  )
}

/** The agent's reply: a short lead line, compact rows, a takeaway. */
function Answer({
  lead,
  rows,
  footer,
}: {
  lead: string
  rows: readonly {
    name: string
    detail: string
    value: string
    tone?: "good" | "bad"
  }[]
  footer: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-illustration p-4 text-foreground">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <LogoMark className="size-4" />
        {lead}
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {rows.map((row) => (
          <li
            className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2"
            key={row.name}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.detail}
              </p>
            </div>
            <p
              className={cn(
                "shrink-0 text-sm font-medium tabular-nums",
                row.tone === "bad" && "text-destructive",
                row.tone === "good" && "text-illustration-positive",
              )}
            >
              {row.value}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm leading-snug">{footer}</p>
    </div>
  )
}

function FindingMockup() {
  return (
    <div className="flex flex-col gap-1.5">
      <Prompt>Which hiring companies match my profile?</Prompt>
      <Answer
        footer={
          <>
            <span className="font-medium">25 people</span> across three
            signals. Match counts are free — a search costs 2 credits a page.
          </>
        }
        lead="Signals · live match counts"
        rows={[
          {
            name: "Hiring marketers",
            detail: "180 people match",
            value: "3",
            tone: "good",
          },
          {
            name: "Recently funded",
            detail: "96 people match",
            value: "2",
          },
          {
            name: "Growing headcount",
            detail: "240 people match",
            value: "1",
          },
        ]}
      />
    </div>
  )
}

function ResearchMockup() {
  return (
    <div className="flex flex-col gap-1.5">
      <Prompt>Why is this lead worth an email?</Prompt>
      <Answer
        footer="Funded last quarter, three marketing roles open. Approve the lead and it finds the address."
        lead="VP Marketing · at a 200-person SaaS company"
        rows={[
          {
            name: "Funded last quarter",
            detail: "Buying signal",
            value: "3",
            tone: "good",
          },
          {
            name: "Hiring marketers",
            detail: "Three roles open",
            value: "3",
            tone: "good",
          },
          {
            name: "Uses a competitor tool",
            detail: "From their hiring post",
            value: "2",
          },
        ]}
      />
    </div>
  )
}

function SendingMockup() {
  return (
    <div className="flex flex-col gap-1.5">
      <Prompt>What goes out this week?</Prompt>
      <Answer
        footer="Nothing sends until you approve the exact text. Every email carries an opt-out line."
        lead="Review mode · waiting on you"
        rows={[
          {
            name: "First email",
            detail: "VP Marketing · written for them",
            value: "1",
          },
          {
            name: "Follow-up one",
            detail: "Goes out only if nobody replies",
            value: "1",
          },
          {
            name: "Follow-up two",
            detail: "Last touch, then it stops",
            value: "1",
            tone: "bad",
          },
        ]}
      />
    </div>
  )
}

// Every mockup answers a question someone actually asks before signing up,
// using only what the product does: signal searches, research notes with
// 1–3 scores, and Review-mode approvals. Figures are illustrative.
const features = [
  {
    eyebrow: "Finding",
    title: "Find leads on buying signals, not lists",
    description:
      "Each search is one signal crossed with your own fit: funded, hiring, growing, or a keyword you care about.",
    background: "/marketing/backgrounds/forest-peach-ridge.webp",
    backgroundPosition: "object-[50%_70%]",
    tags: ["Funded", "Hiring", "Headcount", "Keywords"],
    Illustration: FindingMockup,
  },
  {
    eyebrow: "Research",
    title: "Know why each lead is worth an email",
    description:
      "The agent reads the company's own site and writes a short note on why this lead is worth contacting, then scores them 1 to 3.",
    background: "/marketing/backgrounds/forest-peach-stream.webp",
    backgroundPosition: "object-[40%_65%]",
    tags: ["Notes", "Scores", "Signals"],
    Illustration: ResearchMockup,
  },
  {
    eyebrow: "Sending",
    title: "Emails from your inbox, with your approval",
    description:
      "One email written for that one person, then two follow-ups if they stay quiet. Review keeps every send waiting on you.",
    background: "/marketing/backgrounds/forest-peach-clearing.webp",
    backgroundPosition: "object-[65%_70%]",
    tags: ["Your inbox", "Two approvals", "Follow-ups", "Opt-out"],
    Illustration: SendingMockup,
  },
] as const

/**
 * Alternating rows: a large illustration panel beside its copy, switching
 * sides each row so the eye zigzags down the section.
 */
export function Features() {
  const revealViewport = useRevealViewport()

  return (
    <MarketingSection id="features">
      <MarketingSectionIntro
        align="center"
        description="Finding, research and sending — each one paired with the control that keeps it safe."
        eyebrow="Features"
        icon={Layers01Icon}
        revealViewport={revealViewport}
        title="What it can do for you"
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
                className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
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
                  <div className="w-full max-w-sm rounded-2xl bg-illustration/40 p-1.5 shadow-xl shadow-foreground/10 backdrop-blur-sm">
                    <Illustration />
                  </div>
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
