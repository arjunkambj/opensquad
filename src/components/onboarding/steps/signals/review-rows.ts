/**
 * The seven rows of the review screen (reference 11).
 *
 * Every summary is read back from what was actually saved — the business
 * profile, the agent's ICP, its goal and tone, the strategies that are
 * switched on and the keywords that were picked. Nothing is defaulted for
 * display: a row with no answer says so in words, because "—" on a review
 * screen is how a user ends up confirming something they never chose.
 *
 * Each row names the step that wrote it, which is the one thing a review
 * screen owes: a way back. Building the control for that is the screen's job,
 * not this file's — rows are data, so nothing here renders or is handed a
 * callback.
 */
import {
  BlockedIcon,
  Building01Icon,
  FilterHorizontalIcon,
  SparklesIcon,
  Tag01Icon,
  Target01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import type { ReviewAccordionRow } from "@/components/kit/ReviewAccordion"
import {
  companySizeBand,
  excludeProfileOption,
} from "../../../../../convex/agents/icpVocabulary"
import type { AgentIcp } from "../../../../../convex/lib/validators"
import type { OnboardingStep } from "../../../../../convex/lib/validators"
import {
  GOAL_OPTIONS,
  TONE_OPTIONS,
} from "@/components/onboarding/steps/outreach/outreach-step-model"

export type ReviewSource = {
  companyName: string
  industry: string
  icp: AgentIcp
  goal: string
  tone: string
  signals: string[]
  keywords: string[]
}

/** A list read back as one line, or the sentence that says it is empty. */
function readBack(values: readonly string[], empty: string): string {
  return values.length === 0 ? empty : values.join(", ")
}

function optionTitle(
  options: readonly { value: string; title: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.title ?? value
}

/** A row of the review list, plus the way back to the step behind it. */
export type ReviewRow = Omit<ReviewAccordionRow, "content"> & {
  /** The step this answer was given on; "Change this" reopens it. */
  step: OnboardingStep
  /** One line on what changing it affects. */
  hint: string
}

export function buildReviewRows(source: ReviewSource): ReviewRow[] {
  const sizes = source.icp.companySizes.map(
    (value) => companySizeBand(value)?.label ?? value,
  )
  const exclusions = source.icp.excludeProfiles.map(
    (value) => excludeProfileOption(value)?.label ?? value,
  )

  return [
    {
      id: "company",
      icon: Building01Icon,
      label: "What you sell",
      summary: `${source.companyName} — ${source.industry}`,
      step: "company",
      hint: "Your agent writes from this profile, so it is worth being accurate.",
    },
    {
      id: "job-titles",
      icon: UserGroupIcon,
      label: "Job roles",
      summary: readBack(source.icp.jobTitles, "Anyone at a matching company"),
      step: "icp_job_titles",
      hint: "The titles your agent looks for. Similar ones are matched automatically.",
    },
    {
      id: "company-filters",
      icon: FilterHorizontalIcon,
      label: "Companies",
      summary: [
        readBack(source.icp.industries, "All industries"),
        readBack(sizes, "Any size"),
        readBack(source.icp.companyTypes, "Any kind of organisation"),
        readBack(source.icp.locations, "Worldwide"),
      ].join(" · "),
      step: "icp_company_filters",
      hint: "The companies those people work at.",
    },
    {
      id: "exclusions",
      icon: BlockedIcon,
      label: "Left out",
      summary: readBack(
        [...exclusions, ...source.icp.excludeKeywords],
        "Nobody is excluded",
      ),
      step: "icp_exclusions",
      hint: "The people and companies your agent skips, whatever else matches.",
    },
    {
      id: "goal",
      icon: Target01Icon,
      label: "Goal and tone",
      summary: `${optionTitle(GOAL_OPTIONS, source.goal)} · ${optionTitle(
        TONE_OPTIONS,
        source.tone,
      )}`,
      step: "outreach_goals",
      hint: "What the outreach is for, and how it reads.",
    },
    {
      id: "signals",
      icon: SparklesIcon,
      label: "Signals",
      summary: readBack(source.signals, "No signals switched on yet"),
      step: "signals_strategies",
      hint: "The searches your agent runs, in the order it found them.",
    },
    {
      id: "keywords",
      icon: Tag01Icon,
      label: "Keywords",
      summary: readBack(
        source.keywords,
        "None — your agent won't watch for topics",
      ),
      step: "signals_keywords",
      hint: "Words your agent watches for on people's own profiles.",
    },
  ]
}
