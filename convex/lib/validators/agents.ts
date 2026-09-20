/**
 * Agent validators: the one sales agent a workspace runs — its mode, status,
 * onboarding step, goal, tone, ICP, run state and autopilot caps — plus the
 * search-strategy and lead-filter vocabulary the agent sources leads with.
 */
import { v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * How much the agent may do on its own (PLAN §1, §9.3). `sourcing_only` is
 * the default until an inbox is connected: it finds and researches leads and
 * contacts nobody. Autopilot is never entered by a migration or a reconnect —
 * only by the consent dialog that writes `agents.autopilot`.
 */
export const AGENT_MODES = [
  "sourcing_only",
  "review",
  "autopilot",
  "paused",
] as const;

export const vAgentMode = v.union(
  v.literal("sourcing_only"),
  v.literal("review"),
  v.literal("autopilot"),
  v.literal("paused"),
);

export type AgentMode = (typeof AGENT_MODES)[number];

/** Modes in which the agent may put mail on the wire at all (PLAN §9.3). */
export const SENDING_AGENT_MODES: readonly AgentMode[] = [
  "review",
  "autopilot",
];

/**
 * `draft` while onboarding is still filling the agent in; `live` from the
 * moment "Confirm & find leads" is pressed. The run cron selects live agents
 * whose `nextRunAt` is due — nothing else starts a run (EXECUTION "API
 * hand-offs": T23 flips the flag, T30 reads it).
 */
export const vAgentStatus = v.union(v.literal("draft"), v.literal("live"));

export type AgentStatus = "draft" | "live";

/**
 * Where the onboarding stepper resumes (PLAN §5 "Progress is saved per step",
 * §11 M1). One member per dot **and** per sub-step, because the reference
 * splits dots 2–4 into sub-screens and a refresh must land on the sub-screen
 * the user left — a bare dot number cannot express that. `done` is the
 * finished state the `/onboarding` guard redirects away from.
 */
export const ONBOARDING_STEPS = [
  "company",
  "icp_job_titles",
  "icp_company_filters",
  "icp_exclusions",
  "outreach_inbox",
  "outreach_goals",
  "signals_strategies",
  "signals_keywords",
  "signals_review",
  "done",
] as const;

export const vOnboardingStep = v.union(
  v.literal("company"),
  v.literal("icp_job_titles"),
  v.literal("icp_company_filters"),
  v.literal("icp_exclusions"),
  v.literal("outreach_inbox"),
  v.literal("outreach_goals"),
  v.literal("signals_strategies"),
  v.literal("signals_keywords"),
  v.literal("signals_review"),
  v.literal("done"),
);

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** What the outreach is for (PLAN §7, reference 05). */
export const vAgentGoal = v.union(
  v.literal("start_conversations"),
  v.literal("book_calls"),
);

export type AgentGoal = "start_conversations" | "book_calls";

/** How the outreach reads (PLAN §7, reference 05). */
export const vAgentTone = v.union(
  v.literal("professional"),
  v.literal("conversational"),
  v.literal("direct"),
);

export type AgentTone = "professional" | "conversational" | "direct";

/**
 * The ideal customer profile the strategies are built from (PLAN §7). Every
 * member is a list so an empty ICP is a valid draft state — onboarding fills
 * them one sub-step at a time and `onboardingStep` says how far it got.
 * Values are the provider's own allowed strings, re-checked against the
 * cached `leadFilterOptions` before any search (PLAN §3 step 2).
 */
export const vAgentIcp = v.object({
  jobTitles: v.array(v.string()),
  industries: v.array(v.string()),
  locations: v.array(v.string()),
  companyTypes: v.array(v.string()),
  companySizes: v.array(v.string()),
  excludeProfiles: v.array(v.string()),
  excludeKeywords: v.array(v.string()),
});

export type AgentIcp = Infer<typeof vAgentIcp>;

/** An ICP with every list empty — the shape a draft agent starts from. */
export const EMPTY_AGENT_ICP: AgentIcp = {
  jobTitles: [],
  industries: [],
  locations: [],
  companyTypes: [],
  companySizes: [],
  excludeProfiles: [],
  excludeKeywords: [],
};

/**
 * The single-flight lease a run holds (PLAN §9.1). A second trigger is a
 * no-op while `leaseUntil` is in the future, and every step re-checks it
 * still holds `leaseId` before writing.
 */
export const vAgentRun = v.object({
  leaseId: v.string(),
  leaseUntil: v.number(),
  startedAt: v.number(),
});

export type AgentRun = Infer<typeof vAgentRun>;

/**
 * Recorded Autopilot consent (PLAN §9.3). The `revision` is the agent
 * revision the user consented under, so a later instruction change is
 * visible as "consented under an older revision" rather than silently
 * re-authorised.
 */
export const vAgentAutopilot = v.object({
  authorizedBy: v.string(),
  authorizedAt: v.number(),
  revision: v.number(),
});

export type AgentAutopilot = Infer<typeof vAgentAutopilot>;

export const AGENT_NAME_MAX_LENGTH = 120;

export const AGENT_INSTRUCTIONS_MAX_LENGTH = 8_000;

export const AGENT_KEYWORDS_MAX = 25;

export const AGENT_KEYWORD_MAX_LENGTH = 100;

export const ICP_LIST_MAX_ITEMS = 50;

export const ICP_VALUE_MAX_LENGTH = 200;

export const AGENT_FOLLOW_UP_DAYS_MAX = 4;

/** Defaults from PLAN §9.2/§9.3; retuned in `lib/limits.ts` (T02). */
export const AGENT_DAILY_LEAD_CAP_DEFAULT = 25;

export const AGENT_DAILY_RESEARCH_CAP_DEFAULT = 5;

export const AGENT_AUTO_REVEAL_DAILY_CAP_DEFAULT = 5;

export const AGENT_AUTO_APPROVE_MIN_SCORE_DEFAULT = 2;

export const AGENT_FOLLOW_UP_DAYS_DEFAULT: readonly number[] = [3, 7];

/**
 * The signal a strategy is built on. Exactly the catalogue of PLAN §3 —
 * only signals the lead-data API can actually answer are offered, and
 * `core_icp` is always present.
 */
export const SIGNAL_KINDS = [
  "core_icp",
  "funded",
  "hiring",
  "growth",
  "ad_spend",
  "tech",
  "team_shape",
  "keyword",
] as const;

export const vSignalKind = v.union(
  v.literal("core_icp"),
  v.literal("funded"),
  v.literal("hiring"),
  v.literal("growth"),
  v.literal("ad_spend"),
  v.literal("tech"),
  v.literal("team_shape"),
  v.literal("keyword"),
);

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** Who put the strategy there (PLAN §7). */
export const vStrategySource = v.union(
  v.literal("recommended"),
  v.literal("user"),
);

export type StrategySource = "recommended" | "user";

/**
 * One stored lead-search filter value. The provider's filter set is ~139
 * fields of scalars and string lists (spikes §3), so the stored shape is a
 * bounded record rather than 139 columns. It is NOT a free-form bag: the
 * filter builder (T11) accepts a key only when the cached
 * `leadFilterOptions` declares it, and an enum value only when that filter's
 * `values` contains it — a typo silently returns zero rows otherwise.
 */
export const vLeadFilterValue = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
);

export const vLeadFilters = v.record(v.string(), vLeadFilterValue);

export type LeadFilters = Infer<typeof vLeadFilters>;

/** One cached allowed-value set, as the provider's filter catalogue states it. */
export const vLeadFilterOption = v.object({
  label: v.string(),
  category: v.union(
    v.literal("person"),
    v.literal("organization"),
    v.literal("insights"),
  ),
  /** Empty for the free-text filters (spikes §3) — not a failed fetch. */
  values: v.array(v.string()),
  maxSelections: v.number(),
});

export type LeadFilterOption = Infer<typeof vLeadFilterOption>;

export const STRATEGY_TITLE_MAX_LENGTH = 120;

export const STRATEGY_RATIONALE_MAX_LENGTH = 400;
