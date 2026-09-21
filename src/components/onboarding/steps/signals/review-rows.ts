import {
  BlockedIcon,
  Building01Icon,
  FilterHorizontalIcon,
  SparklesIcon,
  Tag01Icon,
  Target01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"
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

function optionTitle(
  options: readonly { value: string; title: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.title ?? value
}

export type ReviewRow = {
  id: string
  icon: IconSvgElement
  label: string
  /** Shown as chips. */
  values: string[]
  /** Said instead of chips when there are none. */
  empty: string
  /** Muted line under the chips for the secondary filters. */
  note?: string
  step: OnboardingStep
  /** Tooltip on Edit. */
  hint: string
}

function anyOr(values: readonly string[], empty: string): string {
  return values.length === 0 ? empty : values.join(", ")
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
      values: [source.companyName, source.industry].filter(
        (value) => value.trim() !== "",
      ),
      empty: "Not filled in",
      step: "company",
      hint: "Your agent writes from this profile, so it is worth being accurate.",
    },
    {
      id: "job-titles",
      icon: UserGroupIcon,
      label: "Job roles",
      values: source.icp.jobTitles,
      empty: "Anyone at a matching company",
      step: "icp_job_titles",
      hint: "The titles your agent looks for. Similar ones are matched automatically.",
    },
    {
      id: "company-filters",
      icon: FilterHorizontalIcon,
      label: "Companies",
      values: source.icp.industries,
      empty: "All industries",
      note: [
        anyOr(sizes, "Any size"),
        anyOr(source.icp.companyTypes, "Any kind of organisation"),
        anyOr(source.icp.locations, "Worldwide"),
      ].join(" · "),
      step: "icp_company_filters",
      hint: "The companies those people work at.",
    },
    {
      id: "exclusions",
      icon: BlockedIcon,
      label: "Excluded",
      values: [...exclusions, ...source.icp.excludeKeywords],
      empty: "Nobody is excluded",
      step: "icp_exclusions",
      hint: "The people and companies your agent skips, whatever else matches.",
    },
    {
      id: "goal",
      icon: Target01Icon,
      label: "Goal and tone",
      values: [
        optionTitle(GOAL_OPTIONS, source.goal),
        optionTitle(TONE_OPTIONS, source.tone),
      ],
      empty: "Not set",
      step: "outreach_goals",
      hint: "What the outreach is for, and how it reads.",
    },
    {
      id: "signals",
      icon: SparklesIcon,
      label: "Signals",
      values: source.signals,
      empty: "No signals switched on yet",
      step: "signals_strategies",
      hint: "The searches your agent runs, in the order it found them.",
    },
    {
      id: "keywords",
      icon: Tag01Icon,
      label: "Keywords",
      values: source.keywords,
      empty: "None",
      step: "signals_keywords",
      hint: "Words your agent watches for on people's own profiles.",
    },
  ]
}
