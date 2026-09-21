/** Server-only pricing attribution, provider caps and platform budgets.
 * Browser code imports public credit prices from prices.ts instead. */
import type { RateLimitConfig } from "@convex-dev/rate-limiter";
import { env } from "../_generated/server";
import { ACTION_PRICES as POSTED_PRICES } from "./prices";
import type { PaidAction, PostedPrice } from "./prices";
import type { ProviderKind } from "./validators";

export { PAID_ACTIONS, TRIAL_DAILY_SEND_LIMIT_MAX } from "./prices";
export type { PaidAction } from "./prices";

/** Keep names aligned with convex.config.ts so typed env reads catch misspellings. */
export type TunableEnvName =
  | "PLATFORM_PAUSED"
  | "ENRICH_DAILY_CREDIT_BUDGET"
  | "ENRICH_MONTHLY_SEARCH_BUDGET"
  | "AI_DAILY_CALL_BUDGET"
  | "FIRECRAWL_DAILY_BUDGET"
  | "MAX_TRIAL_ORGS"
  | "ENRICH_BALANCE_FLOOR"
  | "PAID_CALL_STALE_MS"
  | "UNCERTAIN_HOLD_MAX_AGE_MS";

/**
 * A paid action's posted price (`prices.ts`) plus the attribution only the
 * server may know.
 */
export type ActionPrice = PostedPrice & {
  /** The provider the operation record is attributed to. Server-side only. */
  provider: ProviderKind;
};

/** PLAN §6 layer-1 table: the posted prices, each attributed to the provider
 *  that answers it. The credits come from `prices.ts` rather than being
 *  restated, so what a screen quotes is what a call charges. */
export const ACTION_PRICES: Record<PaidAction, ActionPrice> = {
  analyze_website: { ...POSTED_PRICES.analyze_website, provider: "firecrawl" },
  generate_icp: { ...POSTED_PRICES.generate_icp, provider: "ai_gateway" },
  recommend_signals: { ...POSTED_PRICES.recommend_signals, provider: "ai_gateway" },
  generate_keywords: { ...POSTED_PRICES.generate_keywords, provider: "ai_gateway" },
  find_leads: { ...POSTED_PRICES.find_leads, provider: "enrich" },
  research_lead: { ...POSTED_PRICES.research_lead, provider: "firecrawl" },
  get_email: { ...POSTED_PRICES.get_email, provider: "enrich" },
  write_email: { ...POSTED_PRICES.write_email, provider: "ai_gateway" },
  handle_reply: { ...POSTED_PRICES.handle_reply, provider: "ai_gateway" },
  profile_company: { ...POSTED_PRICES.profile_company, provider: "ai_gateway" },
  score_lead: { ...POSTED_PRICES.score_lead, provider: "ai_gateway" },
};

/** The lifetime grant, made with the org and never refilled (PLAN §6). */
export const TRIAL_CREDIT_GRANT = 300;

/** Keep thresholds ascending: the first match must report out-of-credits after a large drop.
 * Each threshold event is emitted once per org. */
export const CREDITS_LOW_THRESHOLDS: readonly number[] = [0, 50];

/**
 * The metrics a paid call reserves in the provider's own units. `credits` is
 * layer 1 and `sends` is bounded by the org's own daily send limit
 * against the user's own mail key, so neither is capped here.
 */
export const TRIAL_METERED_METRICS = [
  "enrich_credits",
  "enrich_searches",
  "ai_calls",
  "scrapes",
] as const;

export type TrialMeteredMetric = (typeof TRIAL_METERED_METRICS)[number];

/** Worst-case provider units one paid call declares up front. */
export type ProviderUnits = Partial<Record<TrialMeteredMetric, number>>;

/**
 * PLAN §6 layer-2 table — the real guarantee. The hidden lifetime cap is why
 * "trial limit for emails reached" is a different message from "out of
 * credits": an org can hold credits it is no longer allowed to spend.
 */
export const TRIAL_METRIC_CAPS: Record<
  TrialMeteredMetric,
  { lifetime: number; daily: number }
> = {
  enrich_credits: { lifetime: 100, daily: 50 },
  enrich_searches: { lifetime: 12, daily: 6 },
  ai_calls: { lifetime: 400, daily: 40 },
  scrapes: { lifetime: 80, daily: 15 },
};

/**
 * Deployment env var whose value, when exactly `"true"`, stops every paid
 * call instantly — no deploy, no code path left open (PLAN §6).
 */
export const PLATFORM_PAUSED_ENV: TunableEnvName = "PLATFORM_PAUSED";

export type PlatformBudgetPolicy = {
  provider: ProviderKind;
  /** Which calendar the budget resets on. UTC, deliberately: a platform
   *  budget is our bill, not any one org's local day. */
  periodKind: "utc_day" | "utc_month";
  /** Distinguishes two budgets of the SAME provider in the period key, since
   *  `platformBudgets` is unique per (provider, periodKey). */
  periodPrefix: string;
  /** Declared in `convex.config.ts` and read through the typed `env`, so a
   *  budget cannot be wired to a name no deployment will ever set. */
  envName: TunableEnvName;
  /**
   * Used when the env var is absent. Conservative by design: a budget that
   * defaulted to "unlimited" would make the whole layer decorative, and one
   * that defaulted to zero would make a fresh deployment look broken.
   */
  defaultLimit: number;
};

export const PLATFORM_BUDGETS: Record<TrialMeteredMetric, PlatformBudgetPolicy> =
  {
    enrich_credits: {
      provider: "enrich",
      periodKind: "utc_day",
      periodPrefix: "credits",
      envName: "ENRICH_DAILY_CREDIT_BUDGET",
      defaultLimit: 200,
    },
    enrich_searches: {
      provider: "enrich",
      periodKind: "utc_month",
      periodPrefix: "searches",
      envName: "ENRICH_MONTHLY_SEARCH_BUDGET",
      // KEEP THIS AT OR BELOW 50. The lead-data account gives away 50 unique
      // searches a month and every search past them is billed per row, so
      // this budget is the ONLY thing standing between the platform and a
      // real invoice: the per-org caps bound one trial, and nothing else
      // counts the month across every org. Raising it above the free pool
      // means paying for searches, deliberately.
      defaultLimit: 40,
    },
    ai_calls: {
      provider: "ai_gateway",
      periodKind: "utc_day",
      periodPrefix: "calls",
      envName: "AI_DAILY_CALL_BUDGET",
      defaultLimit: 1_000,
    },
    scrapes: {
      provider: "firecrawl",
      periodKind: "utc_day",
      periodPrefix: "pages",
      envName: "FIRECRAWL_DAILY_BUDGET",
      defaultLimit: 300,
    },
  };

/** How many trial orgs exist before new signups see the waitlist. */
export const MAX_TRIAL_ORGS_ENV: TunableEnvName = "MAX_TRIAL_ORGS";

export const MAX_TRIAL_ORGS_DEFAULT = 50;

/** Shared scan bound keeps counts consistent across screens. Report hasMore instead of a truncated total. */
export const COUNT_SCAN_BOUND = 100;

/**
 * A paid call whose operation row has not moved in this long lost its action
 * (a Convex action cannot outlive ~10 minutes), so the sweep parks it as
 * `uncertain` — capacity stays blocked, because a lost action is not proof
 * the request never left.
 */
export const PAID_CALL_STALE_MS_DEFAULT = 15 * 60 * 1000;

export const PAID_CALL_STALE_MS_ENV: TunableEnvName = "PAID_CALL_STALE_MS";

export function paidCallStaleMs(): number {
  return readIntEnv(PAID_CALL_STALE_MS_ENV, PAID_CALL_STALE_MS_DEFAULT);
}

/**
 * PLAN §6: an `uncertain` hold still unknown after this long is committed at
 * worst case. We never hand back money we may have spent.
 */
export const UNCERTAIN_HOLD_MAX_AGE_MS_DEFAULT = 24 * 60 * 60 * 1000;

export const UNCERTAIN_HOLD_MAX_AGE_MS_ENV: TunableEnvName =
  "UNCERTAIN_HOLD_MAX_AGE_MS";

/**
 * Both windows are env-tunable because recovery timing is an operational
 * decision, not a product one: shortening the window during an incident — or
 * to prove the sweep works on a deployment — must not need a deploy.
 */
export function uncertainHoldMaxAgeMs(): number {
  return readIntEnv(
    UNCERTAIN_HOLD_MAX_AGE_MS_ENV,
    UNCERTAIN_HOLD_MAX_AGE_MS_DEFAULT,
  );
}

/** Rows one sweep pass settles, so a pass stays inside one transaction. */
export const SWEEP_BATCH_SIZE = 50;

/** The run loop retries due leads using this shared per-step schedule; failed actions do not retry themselves. */
export const STEP_RETRY_DELAYS_MS: readonly number[] = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  4 * 60 * 60 * 1000,
];

/** Count attempts per step and lead so failures in research do not consume outreach retries. */
export const STEP_MAX_ATTEMPTS = STEP_RETRY_DELAYS_MS.length + 1;

/**
 * Token buckets per user on every credit-spending entry point (PLAN §6
 * "Closing the ways in"), so a script cannot burn a day's allowance in a
 * second or flood the scheduler. `capacity` equals `rate` unless a short
 * burst is genuinely part of the flow.
 */
export const RATE_LIMITS = {
  // Creating an org is the door the trial grant comes through, so it is
  // rate-limited like any other credit-spending entry: the grant is handed
  // out here, and the scheduler is handed a draft agent with it.
  ensureOrg: { kind: "token bucket", rate: 5, period: 60_000, capacity: 5 },
  analyzeWebsite: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  generateIcp: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  recommendSignals: {
    kind: "token bucket",
    rate: 3,
    period: 60_000,
    capacity: 3,
  },
  regenerate: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  // The last step of setup. It buys nothing, but it fans out up to three
  // counts against the platform's own provider quota, so it is limited like
  // every other door that reaches a provider.
  confirmSignals: { kind: "token bucket", rate: 5, period: 60_000, capacity: 5 },
  researchLead: { kind: "token bucket", rate: 10, period: 60_000, capacity: 10 },
  // Re-queueing a parked lead spends nothing itself, but it pushes that lead
  // straight back into the paid loop, so it is a credit-spending door.
  retryLead: { kind: "token bucket", rate: 10, period: 60_000, capacity: 10 },
  revealEmail: { kind: "token bucket", rate: 10, period: 60_000, capacity: 10 },
  runAgentNow: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  connectInbox: { kind: "token bucket", rate: 5, period: 60_000, capacity: 5 },
  // Dev-only org wipe. Tight on purpose: it deletes the tenant.
  resetOrg: { kind: "token bucket", rate: 1, period: 60_000, capacity: 1 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Leads a live agent may source in one org-local day. */
export const AGENT_DAILY_LEAD_CAP_DEFAULT = 25;

/** Leads it may research — deliberately small, research is 3 credits each. */
export const AGENT_DAILY_RESEARCH_CAP_DEFAULT = 5;

/** Emails it may reveal on its own; the expensive step, so the tightest cap. */
export const AGENT_AUTO_REVEAL_DAILY_CAP_DEFAULT = 5;

/** The flame score at or above which autopilot approves without asking. */
export const AGENT_AUTO_APPROVE_MIN_SCORE_DEFAULT = 2;

/** Days after the previous mail that a follow-up goes out. */
export const AGENT_FOLLOW_UP_DAYS_DEFAULT: readonly number[] = [3, 7];

/** Unset settings use the fallback; malformed values throw to avoid silently weakening spending limits. */
export function readIntEnv(name: TunableEnvName, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

/** `true` only for the exact string `"true"` — anything else leaves paid
 *  calls running, so a typo in the VALUE can never silently pause the
 *  product, and a typo in the NAME no longer silently un-pauses it. */
export function readBooleanEnv(name: TunableEnvName): boolean {
  return env[name] === "true";
}
