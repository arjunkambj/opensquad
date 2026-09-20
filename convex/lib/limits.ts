/**
 * Every number the product spends money against, in one place (PLAN §6, §10
 * "No magic numbers"). Nothing here reads the database: these are the policy
 * constants a call site looks up, so retuning a price or a cap is a one-line
 * change here and never a hunt through handlers.
 *
 * Three layers live side by side because a paid call must pass all of them:
 *   1. the visible credit price of an action (what the user sees spend),
 *   2. the hidden per-org provider caps in the provider's own units,
 *   3. the platform-wide budgets and the kill switch, which bound OUR bill
 *      whatever any one org does.
 *
 * There is one plan, `trial`. When a real plan map arrives it replaces the
 * lookups below, not their call sites.
 */
import type { RateLimitConfig } from "@convex-dev/rate-limiter";
import type { ProviderKind } from "./validators";

/* ------------------------------------------------------------------ */
/* Layer 1 · visible credits                                           */
/* ------------------------------------------------------------------ */

/**
 * Everything that costs us money, named by what the USER did — not by which
 * provider answered. The union is the key of the price table below, so a new
 * paid step cannot be added without pricing it.
 */
export const PAID_ACTIONS = [
  "analyze_website",
  "generate_icp",
  "recommend_signals",
  "generate_keywords",
  "find_leads",
  "research_lead",
  "get_email",
  "write_email",
  "handle_reply",
  // The AI half of a two-provider action. Zero credits by design: the user
  // pays once, on the step that fetched the page (`analyze_website`,
  // `research_lead`), and a failed AI half is retried from the stored markdown
  // without buying the page again (PLAN §6 "billed … even if a later step
  // failed"). Still a paid call, so it is metered and capped in `ai_calls`.
  "profile_company",
  "score_lead",
] as const;

export type PaidAction = (typeof PAID_ACTIONS)[number];

export type ActionPrice = {
  /** Credits the action costs once it is no longer free. */
  credits: number;
  /**
   * The first successful run of this action in an org is free (PLAN §6:
   * "First-run onboarding … 0 (once each)"). Every later run costs `credits`,
   * which is what the reference's "Re-run" and "Generate more" buttons spend.
   */
  firstRunFree: boolean;
  /** The provider the operation record is attributed to. Server-side only. */
  provider: ProviderKind;
};

/** PLAN §6 layer-1 table. Browsing, counting, approving and sending are free
 *  and therefore absent — a free step never calls the credit wrapper. */
export const ACTION_PRICES: Record<PaidAction, ActionPrice> = {
  analyze_website: { credits: 3, firstRunFree: true, provider: "firecrawl" },
  generate_icp: { credits: 3, firstRunFree: true, provider: "ai_gateway" },
  recommend_signals: { credits: 3, firstRunFree: true, provider: "ai_gateway" },
  generate_keywords: { credits: 3, firstRunFree: false, provider: "ai_gateway" },
  find_leads: { credits: 2, firstRunFree: false, provider: "enrich" },
  research_lead: { credits: 3, firstRunFree: false, provider: "firecrawl" },
  get_email: { credits: 15, firstRunFree: false, provider: "enrich" },
  write_email: { credits: 1, firstRunFree: false, provider: "ai_gateway" },
  handle_reply: { credits: 1, firstRunFree: false, provider: "ai_gateway" },
  profile_company: { credits: 0, firstRunFree: false, provider: "ai_gateway" },
  score_lead: { credits: 0, firstRunFree: false, provider: "ai_gateway" },
};

/** The lifetime grant, made with the org and never refilled (PLAN §6). */
export const TRIAL_CREDIT_GRANT = 300;

/* ------------------------------------------------------------------ */
/* Layer 2 · hidden provider caps per org                        */
/* ------------------------------------------------------------------ */

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
 * The org's lifetime page allowance, named for the one caller that
 * reserves it directly (`integrations/firecrawl.ts`) rather than through the
 * credit wrapper, because its per-prospect cap is its own rule.
 */
export const TRIAL_SCRAPES_LIFETIME_LIMIT = TRIAL_METRIC_CAPS.scrapes.lifetime;

/** PLAN §6: the trial's daily send ceiling, whatever the owner types. */
export const TRIAL_DAILY_SEND_LIMIT_MAX = 30;

/* ------------------------------------------------------------------ */
/* Layer 3 · platform-wide budgets, kill switch and signup capacity    */
/* ------------------------------------------------------------------ */

/**
 * Deployment env var whose value, when exactly `"true"`, stops every paid
 * call instantly — no deploy, no code path left open (PLAN §6).
 */
export const PLATFORM_PAUSED_ENV = "PLATFORM_PAUSED";

export type PlatformBudgetPolicy = {
  provider: ProviderKind;
  /** Which calendar the budget resets on. UTC, deliberately: a platform
   *  budget is our bill, not any one org's local day. */
  periodKind: "utc_day" | "utc_month";
  /** Distinguishes two budgets of the SAME provider in the period key, since
   *  `platformBudgets` is unique per (provider, periodKey). */
  periodPrefix: string;
  envName: string;
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
export const MAX_TRIAL_ORGS_ENV = "MAX_TRIAL_ORGS";

export const MAX_TRIAL_ORGS_DEFAULT = 50;

/* ------------------------------------------------------------------ */
/* Recovery timing                                                     */
/* ------------------------------------------------------------------ */

/**
 * A paid call whose operation row has not moved in this long lost its action
 * (a Convex action cannot outlive ~10 minutes), so the sweep parks it as
 * `uncertain` — capacity stays blocked, because a lost action is not proof
 * the request never left.
 */
export const PAID_CALL_STALE_MS_DEFAULT = 15 * 60 * 1000;

export const PAID_CALL_STALE_MS_ENV = "PAID_CALL_STALE_MS";

export function paidCallStaleMs(): number {
  return readIntEnv(PAID_CALL_STALE_MS_ENV, PAID_CALL_STALE_MS_DEFAULT);
}

/**
 * PLAN §6: an `uncertain` hold still unknown after this long is committed at
 * worst case. We never hand back money we may have spent.
 */
export const UNCERTAIN_HOLD_MAX_AGE_MS_DEFAULT = 24 * 60 * 60 * 1000;

export const UNCERTAIN_HOLD_MAX_AGE_MS_ENV = "UNCERTAIN_HOLD_MAX_AGE_MS";

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

/* ------------------------------------------------------------------ */
/* Per-user rate limits                                                */
/* ------------------------------------------------------------------ */

/**
 * Token buckets per user on every credit-spending entry point (PLAN §6
 * "Closing the ways in"), so a script cannot burn a day's allowance in a
 * second or flood the scheduler. `capacity` equals `rate` unless a short
 * burst is genuinely part of the flow.
 */
export const RATE_LIMITS = {
  analyzeWebsite: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  generateIcp: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  recommendSignals: {
    kind: "token bucket",
    rate: 3,
    period: 60_000,
    capacity: 3,
  },
  regenerate: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  findLeads: { kind: "token bucket", rate: 6, period: 60_000, capacity: 6 },
  researchLead: { kind: "token bucket", rate: 10, period: 60_000, capacity: 10 },
  revealEmail: { kind: "token bucket", rate: 10, period: 60_000, capacity: 10 },
  runAgentNow: { kind: "token bucket", rate: 3, period: 60_000, capacity: 3 },
  connectInbox: { kind: "token bucket", rate: 5, period: 60_000, capacity: 5 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/* ------------------------------------------------------------------ */
/* Agent defaults (PLAN §7)                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Env readers                                                         */
/* ------------------------------------------------------------------ */

/**
 * A non-negative integer deployment setting, or `fallback` when unset. An
 * unreadable value is a deployment mistake, not a reason to spend without a
 * ceiling, so it throws rather than falling back silently.
 */
export function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
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
 *  calls running, so a typo can never silently pause the product. */
export function readBooleanEnv(name: string): boolean {
  return process.env[name] === "true";
}
