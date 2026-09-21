/**
 * The signal recommender — the AI half of onboarding dot 4 (PLAN §3 step 3,
 * references 09 and 10).
 *
 * Like every file in `convex/ai/`, this one holds a task's prompt and the
 * shape of its answer and nothing else: no `ctx`, no database, no provider
 * call. `convex/agents/strategies*.ts` brings the profile, the ideal customer
 * and the cached allowed values, and it — not the model — compiles the core
 * ICP half of every search.
 *
 * Two things this prompt has to get right.
 *
 * ONE SIGNAL PER STRATEGY. A strategy is the user's ideal customer AND one
 * reason to contact them now. The model only ever writes that second half, so
 * a strategy that comes back malformed costs one card, never the whole ICP.
 *
 * FILTERS ARE A LIST, NOT AN OBJECT. The stored filter set is an open record,
 * which a strict JSON schema cannot express (`ai/structured.ts`), so the model
 * answers with a bounded LIST of `{ key, values | atLeast | flag }` entries
 * drawn from the vocabulary it is handed, and the domain turns that list into
 * the record — dropping anything it did not offer. Values are case-sensitive
 * on the search side and a near-miss is a silent zero (spikes §3), so every
 * one is re-checked against the cached catalogue before it is stored.
 */
import {
  AGENT_KEYWORD_MAX_LENGTH,
  STRATEGY_RATIONALE_MAX_LENGTH,
  STRATEGY_TITLE_MAX_LENGTH,
  vSignalKind,
} from "../lib/validators";
import type { SignalKind } from "../lib/validators";
import { shortlistAllowedValues } from "./generateIcp";
import { PLAIN_VOICE_RULES } from "./voice";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/** PLAN §3 step 3: "3–5 strategies … plus 6–10 suggested keywords". */
export const RECOMMENDED_STRATEGIES_MIN = 3;
export const RECOMMENDED_STRATEGIES_MAX = 5;
export const SUGGESTED_KEYWORDS_MIN = 6;
export const SUGGESTED_KEYWORDS_MAX = 10;

/** Filter entries one strategy's signal half may carry. A signal is one idea;
 *  more than two filters on top of the ICP stops being explainable. */
export const STRATEGY_SIGNAL_ENTRIES_MAX = 2;

/** Exclusion entries the model may add on top of the ICP's own. */
export const STRATEGY_EXCLUDE_ENTRIES_MAX = 2;

/** Values one filter entry may carry, whatever the provider's own ceiling. */
const FILTER_ENTRY_VALUES_MAX = 10;

/** Allowed values offered per filter. The longest signal list is 28 values
 *  (funding rounds); anything longer is shortlisted against the profile. */
const SIGNAL_VALUE_CHOICES = 30;

/**
 * How a filter carries its value: a list of allowed values, a numeric
 * MINIMUM, or a yes/no flag. The scalar signal filters are all minimums on
 * the provider's side (spikes §3), which the prompt says in as many words —
 * a model that reads `marketingOpenRolesCountOrg: 1` as "exactly one open
 * role" would write a rationale that lies to the user.
 */
export type SignalFilterKind = "values" | "atLeast" | "flag";

export type SignalFilterSpec = {
  signalKind: SignalKind;
  /** The provider's filter name, as `integrations/enrich/filters.ts` declares
   *  it. Nothing here is invented: an unknown key is a 400. */
  key: string;
  kind: SignalFilterKind;
  /** What the filter means, in words the prompt can use. */
  meaning: string;
  /** A sensible floor for a minimum filter, so a first answer is not wild. */
  defaultMinimum?: number;
};

/**
 * Every signal this product can actually answer (PLAN §3's catalogue), and
 * the filters each one is built from. `core_icp` has no signal filters — it
 * IS the ideal customer — and `keyword` is compiled by the domain from the
 * words the user picked on reference 10, so neither appears here.
 */
export const SIGNAL_FILTER_SPECS: readonly SignalFilterSpec[] = [
  {
    signalKind: "funded",
    key: "lastFundingTypeOrg",
    kind: "values",
    meaning: "the kind of the company's most recent funding round",
  },
  {
    signalKind: "funded",
    key: "lastFundingAmountOrg",
    kind: "atLeast",
    meaning: "smallest last-round amount, in US dollars",
    defaultMinimum: 1_000_000,
  },
  {
    signalKind: "funded",
    key: "totalFundingAmountOrg",
    kind: "atLeast",
    meaning: "smallest total raised, in US dollars",
    defaultMinimum: 1_000_000,
  },
  {
    signalKind: "hiring",
    key: "salesOpenRolesCountOrg",
    kind: "atLeast",
    meaning: "open sales roles",
    defaultMinimum: 1,
  },
  {
    signalKind: "hiring",
    key: "accountExecutiveOpenRolesCountOrg",
    kind: "atLeast",
    meaning: "open account-executive roles",
    defaultMinimum: 1,
  },
  {
    signalKind: "hiring",
    key: "marketingOpenRolesCountOrg",
    kind: "atLeast",
    meaning: "open marketing roles",
    defaultMinimum: 1,
  },
  {
    signalKind: "hiring",
    key: "itOpenRolesCountOrg",
    kind: "atLeast",
    meaning: "open IT roles",
    defaultMinimum: 1,
  },
  {
    signalKind: "hiring",
    key: "securityOpenRolesCountOrg",
    kind: "atLeast",
    meaning: "open security roles",
    defaultMinimum: 1,
  },
  {
    signalKind: "hiring",
    key: "devopsOpenRolesCountOrg",
    kind: "atLeast",
    meaning: "open devops roles",
    defaultMinimum: 1,
  },
  {
    signalKind: "growth",
    key: "employeeOnLinkedinGrowthRateOrg",
    kind: "atLeast",
    meaning: "headcount growth rate, in percent",
    defaultMinimum: 10,
  },
  {
    signalKind: "ad_spend",
    key: "monthlyGoogleAdspendOrg",
    kind: "atLeast",
    meaning: "monthly search-ad spend, in US dollars",
    defaultMinimum: 1_000,
  },
  {
    signalKind: "ad_spend",
    key: "monthlyPaidTrafficOrg",
    kind: "atLeast",
    meaning: "monthly paid visits to the company site",
    defaultMinimum: 1_000,
  },
  {
    signalKind: "ad_spend",
    key: "totalMonthlyTrafficOrg",
    kind: "atLeast",
    meaning: "monthly visits to the company site",
    defaultMinimum: 10_000,
  },
  {
    signalKind: "tech",
    key: "crmTechOrg",
    kind: "values",
    meaning: "the CRM the company runs",
  },
  {
    signalKind: "tech",
    key: "marketingAutomationTechOrg",
    kind: "values",
    meaning: "the marketing-automation tool the company runs",
  },
  {
    signalKind: "tech",
    key: "salesAutomationTechOrg",
    kind: "values",
    meaning: "the sales-automation tool the company runs",
  },
  {
    signalKind: "tech",
    key: "abmTechOrg",
    kind: "values",
    meaning: "the account-based-marketing tool the company runs",
  },
  {
    signalKind: "tech",
    key: "conversationIntelligenceTechOrg",
    kind: "values",
    meaning: "the call-recording tool the company runs",
  },
  {
    signalKind: "tech",
    key: "analyticsTechOrg",
    kind: "values",
    meaning: "the analytics tool the company runs",
  },
  {
    signalKind: "tech",
    key: "cmsTechOrg",
    kind: "values",
    meaning: "the content system the company's site runs on",
  },
  {
    signalKind: "tech",
    key: "eCommercePlatformTechOrg",
    kind: "values",
    meaning: "the storefront platform the company sells on",
  },
  {
    signalKind: "tech",
    key: "cloudProviderTechOrg",
    kind: "values",
    meaning: "the cloud the company hosts on",
  },
  {
    signalKind: "tech",
    key: "developmentTechOrg",
    kind: "values",
    meaning: "the development stack the company builds with",
  },
  {
    signalKind: "tech",
    key: "erpTechOrg",
    kind: "values",
    meaning: "the ERP the company runs",
  },
  {
    signalKind: "tech",
    key: "emailHostingTechOrg",
    kind: "values",
    meaning: "the company's mail host",
  },
  {
    signalKind: "tech",
    key: "emailSecurityTechOrg",
    kind: "values",
    meaning: "the company's mail-security tool",
  },
  {
    signalKind: "tech",
    key: "applicationSecurityTechOrg",
    kind: "values",
    meaning: "the company's application-security tool",
  },
  {
    signalKind: "tech",
    key: "cloudSecurityTechOrg",
    kind: "values",
    meaning: "the company's cloud-security tool",
  },
  {
    signalKind: "team_shape",
    key: "salesRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the sales team",
    defaultMinimum: 5,
  },
  {
    signalKind: "team_shape",
    key: "marketingRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the marketing team",
    defaultMinimum: 5,
  },
  {
    signalKind: "team_shape",
    key: "engineerRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the engineering team",
    defaultMinimum: 5,
  },
  {
    signalKind: "team_shape",
    key: "itRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the IT team",
    defaultMinimum: 5,
  },
  {
    signalKind: "team_shape",
    key: "securityRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the security team",
    defaultMinimum: 3,
  },
  {
    signalKind: "team_shape",
    key: "devopsRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the devops team",
    defaultMinimum: 3,
  },
  {
    signalKind: "team_shape",
    key: "customerSuccessRoleCountOrg",
    kind: "atLeast",
    meaning: "people in the customer-success team",
    defaultMinimum: 3,
  },
  {
    signalKind: "team_shape",
    key: "hasCisoOrg",
    kind: "flag",
    meaning: "the company has a security chief",
  },
  {
    signalKind: "team_shape",
    key: "hasCioOrg",
    kind: "flag",
    meaning: "the company has an IT chief",
  },
  {
    signalKind: "team_shape",
    key: "hasMobileAppOrg",
    kind: "flag",
    meaning: "the company ships a mobile app",
  },
  {
    signalKind: "team_shape",
    key: "hasWebAppOrg",
    kind: "flag",
    meaning: "the company ships a web app",
  },
];

/** The signal filter with this name, or `undefined` — the check that keeps a
 *  key the model invented out of a stored strategy. */
export function signalFilterSpec(key: string): SignalFilterSpec | undefined {
  return SIGNAL_FILTER_SPECS.find((spec) => spec.key === key);
}

/** The five keys an exclusion list may use (spikes §3). Declared here as the
 *  vocabulary the prompt offers; the builder re-checks them anyway. */
export const EXCLUDE_FILTER_KEYS: readonly string[] = [
  "personHeadline",
  "companyHeadline",
  "aboutUs",
  "jobTitle",
  "domain",
];

/**
 * One filter, as the model may state it. Exactly one of the three value
 * members is answered and the other two come back null — the only shape a
 * strict JSON schema can carry for "a key with a value of the right kind".
 */
export const vStrategyFilterEntry = v.object({
  key: v.string(),
  /** For a list filter. */
  values: v.optional(v.array(v.string())),
  /** For a numeric filter. Always a MINIMUM. */
  atLeast: v.optional(v.number()),
  /** For a yes/no filter. */
  flag: v.optional(v.boolean()),
});

export type StrategyFilterEntry = Infer<typeof vStrategyFilterEntry>;

export const vRecommendedStrategy = v.object({
  /** The card label on reference 09, in the user's own words. */
  title: v.string(),
  signalKind: vSignalKind,
  /** One sentence for the card's info tooltip. */
  rationale: v.string(),
  /** The SIGNAL half only. The core ICP half is compiled by the domain. */
  filters: v.array(vStrategyFilterEntry),
  excludeFilters: v.array(vStrategyFilterEntry),
  /** Whether this one should be switched on to begin with. */
  recommended: v.boolean(),
});

export type RecommendedStrategy = Infer<typeof vRecommendedStrategy>;

export const vStrategyRecommendation = v.object({
  strategies: v.array(vRecommendedStrategy),
  keywords: v.array(v.string()),
});

export type StrategyRecommendation = Infer<typeof vStrategyRecommendation>;

/** "Generate more" on reference 10 — keywords and nothing else. */
export const vKeywordSuggestions = v.object({
  keywords: v.array(v.string()),
});

/** One signal filter as it is offered to the model, with its allowed values
 *  already shortlisted by the domain. */
export type SignalFilterOffer = SignalFilterSpec & {
  /** Present for a list filter; already checked against the cached cache. */
  values?: readonly string[];
};

export type StrategyRecommendationInput = {
  profile: {
    companyName: string;
    industry: string;
    description: string;
    keyFeatures: readonly string[];
    painPoints: string;
  };
  /** The ideal customer the user already confirmed, in their own words. */
  icp: {
    jobTitles: readonly string[];
    industries: readonly string[];
    locations: readonly string[];
    companyTypes: readonly string[];
    companySizes: readonly string[];
  };
  signals: readonly SignalFilterOffer[];
};

/** Cut a filter's allowed values to what one call can carry. */
export function shortlistSignalValues(
  values: readonly string[],
  profileText: string,
): string[] {
  return shortlistAllowedValues(values, profileText, SIGNAL_VALUE_CHOICES);
}

export const RECOMMEND_STRATEGIES_SYSTEM = [
  "You choose the searches a sales agent runs. The user has already described",
  "who they sell to; your job is to name the REASONS to contact one of those",
  "people right now, and to express each reason as one search filter.",
  "",
  "Every strategy is the user's ideal customer AND one signal. You never",
  "restate the ideal customer — job titles, industries, locations, company",
  "sizes and company types are added automatically to every strategy you",
  "return, and repeating them would only narrow the search twice.",
  "",
  "Rules:",
  `- Return ${RECOMMENDED_STRATEGIES_MIN} to ${RECOMMENDED_STRATEGIES_MAX}`,
  "  strategies. EXACTLY ONE of them has signalKind \"core_icp\" with an empty",
  "  filters list: that is the ideal customer on its own, and it is always",
  "  present so the agent has something to search even if no signal fits.",
  "- Every other strategy uses a DIFFERENT signalKind, and only the kinds",
  "  listed under SIGNAL FILTERS below.",
  `- A signal strategy carries 1 to ${STRATEGY_SIGNAL_ENTRIES_MAX} filter`,
  "  entries, all from its own signalKind's list.",
  "- A filter entry's `key` is copied character for character from the list.",
  "  A key that is not on the list is discarded, and so is the strategy that",
  "  needed it.",
  "- Answer `values` for a list filter (copying allowed values exactly),",
  "  `atLeast` for a number filter, `flag` for a yes/no filter. The other two",
  "  members are null.",
  "- EVERY number filter is a MINIMUM: `atLeast: 1` means \"one or more\".",
  "  Pick a threshold that is normal for the market, not a heroic one.",
  `- excludeFilters: 0 to ${STRATEGY_EXCLUDE_ENTRIES_MAX} entries, each with`,
  `  \`values\` only, using only these keys: ${EXCLUDE_FILTER_KEYS.join(", ")}.`,
  "  Use it for words that mark a bad fit, not to re-state the ideal customer.",
  `- title: the card label the user reads, at most ${STRATEGY_TITLE_MAX_LENGTH}`,
  "  characters. Say it the way a salesperson would describe the audience to",
  "  a colleague: short, plain, specific. \"Growing teams hiring their first",
  "  performance marketer\", not \"Fast-growing companies facing greater",
  "  acquisition pressure\". Never a filter name, a number of results, or the",
  "  word \"filter\".",
  "- rationale: ONE sentence saying why this signal means they are worth",
  `  contacting now, at most ${STRATEGY_RATIONALE_MAX_LENGTH} characters, in`,
  "  the second person (\"They're hiring …, so …\"). Name the concrete",
  "  reason, not a trend.",
  "- recommended: true for the strategies you would switch on for this user.",
  "  Mark the core_icp one true, and be honest about the rest — a weak signal",
  "  marked true wastes the user's first run.",
  `- keywords: ${SUGGESTED_KEYWORDS_MIN} to ${SUGGESTED_KEYWORDS_MAX} short`,
  "  phrases the buyer would actually write on their own profile or company",
  "  page — the problem in their words, not your product's name. Lower case,",
  "  two or three words each, no hashtags, no duplicates.",
  "- Write in the language of the company profile, except for filter keys and",
  "  allowed values, which are copied exactly as given.",
  "",
  ...PLAIN_VOICE_RULES,
].join("\n");

export const GENERATE_KEYWORDS_SYSTEM = [
  "You suggest more words a sales agent can watch for. The user is building a",
  "list of phrases their buyer would write on their own profile or company",
  "page, and already has some.",
  "",
  "Rules:",
  `- Return ${SUGGESTED_KEYWORDS_MIN} to ${SUGGESTED_KEYWORDS_MAX} NEW`,
  "  phrases. Never repeat one the user already has, in any capitalisation.",
  "- Lower case, two or three words each, no hashtags, no punctuation.",
  "- The problem in the buyer's words, or the job they are doing — not the",
  "  seller's product name and not a job title.",
  "- Write in the language of the company profile.",
].join("\n");

function list(entries: readonly string[], empty: string): string {
  return entries.length === 0 ? empty : entries.join(", ");
}

function signalSection(signals: readonly SignalFilterOffer[]): string[] {
  const lines: string[] = [];
  const kinds = [...new Set(signals.map((signal) => signal.signalKind))];
  for (const kind of kinds) {
    lines.push(kind);
    for (const signal of signals.filter((entry) => entry.signalKind === kind)) {
      const shape =
        signal.kind === "values"
          ? `list of values — allowed: ${list(signal.values ?? [], "(none)")}`
          : signal.kind === "atLeast"
            ? `number, a MINIMUM${
                signal.defaultMinimum === undefined
                  ? ""
                  : ` (a usual floor is ${signal.defaultMinimum})`
              }`
            : "yes/no";
      lines.push(`  ${signal.key} — ${signal.meaning}; ${shape}`);
    }
  }
  return lines;
}

export function strategyRecommendationInput(
  input: StrategyRecommendationInput,
): string {
  const { profile, icp, signals } = input;
  return [
    "COMPANY PROFILE",
    `Name: ${profile.companyName}`,
    `Sells in: ${profile.industry}`,
    `What it does: ${profile.description}`,
    `What it offers: ${list(profile.keyFeatures, "(not stated)")}`,
    `Problems its customers have: ${
      profile.painPoints.length === 0 ? "(not stated)" : profile.painPoints
    }`,
    "",
    "IDEAL CUSTOMER (already decided — added to every strategy automatically)",
    `Job titles: ${list(icp.jobTitles, "(any)")}`,
    `Industries: ${list(icp.industries, "(all industries)")}`,
    `Locations: ${list(icp.locations, "(worldwide)")}`,
    `Company types: ${list(icp.companyTypes, "(any)")}`,
    `Company sizes: ${list(icp.companySizes, "(any size)")}`,
    "",
    "SIGNAL FILTERS (copy keys and values exactly)",
    ...signalSection(signals),
  ].join("\n");
}

export function keywordGenerationInput(input: {
  profile: { companyName: string; industry: string; description: string };
  jobTitles: readonly string[];
  existing: readonly string[];
}): string {
  return [
    "COMPANY PROFILE",
    `Name: ${input.profile.companyName}`,
    `Sells in: ${input.profile.industry}`,
    `What it does: ${input.profile.description}`,
    `Buyer's job titles: ${list(input.jobTitles, "(any)")}`,
    "",
    "PHRASES THE USER ALREADY HAS (never repeat these)",
    list(input.existing, "(none yet)"),
  ].join("\n");
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/** Trim, drop blanks, drop case-insensitive duplicates, take the first
 *  `maxItems`. Order is the model's. */
export function boundedPhrases(
  entries: readonly string[],
  maxItems: number,
  itemMax: number,
): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of entries) {
    const value = clamp(entry, itemMax);
    if (value.length === 0) {
      continue;
    }
    const lower = value.toLocaleLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    kept.push(value);
    if (kept.length >= maxItems) {
      break;
    }
  }
  return kept;
}

function boundedEntries(
  entries: readonly StrategyFilterEntry[],
  maxItems: number,
): StrategyFilterEntry[] {
  const kept: StrategyFilterEntry[] = [];
  for (const entry of entries) {
    const key = entry.key.trim();
    if (key.length === 0 || kept.some((seen) => seen.key === key)) {
      continue;
    }
    kept.push({
      key,
      ...(entry.values === undefined
        ? {}
        : {
            values: boundedPhrases(
              entry.values,
              FILTER_ENTRY_VALUES_MAX,
              AGENT_KEYWORD_MAX_LENGTH,
            ),
          }),
      ...(entry.atLeast === undefined ? {} : { atLeast: entry.atLeast }),
      ...(entry.flag === undefined ? {} : { flag: entry.flag }),
    });
    if (kept.length >= maxItems) {
      break;
    }
  }
  return kept;
}

/**
 * Cut a valid-but-oversized answer down to what the agent accepts.
 *
 * The model is schema-constrained on SHAPE, not on length or list size, so a
 * paid generation must not be thrown away because it returned seven
 * strategies. This bounds; it does not CHECK the filter keys or values
 * against the catalogue — that needs the cache, which belongs to the domain.
 */
export function boundStrategyRecommendation(
  generated: StrategyRecommendation,
): StrategyRecommendation {
  return {
    strategies: generated.strategies
      .slice(0, RECOMMENDED_STRATEGIES_MAX)
      .map((strategy) => ({
        title: clamp(strategy.title, STRATEGY_TITLE_MAX_LENGTH),
        signalKind: strategy.signalKind,
        rationale: clamp(strategy.rationale, STRATEGY_RATIONALE_MAX_LENGTH),
        filters: boundedEntries(strategy.filters, STRATEGY_SIGNAL_ENTRIES_MAX),
        excludeFilters: boundedEntries(
          strategy.excludeFilters,
          STRATEGY_EXCLUDE_ENTRIES_MAX,
        ),
        recommended: strategy.recommended,
      })),
    keywords: boundedPhrases(
      generated.keywords,
      SUGGESTED_KEYWORDS_MAX,
      AGENT_KEYWORD_MAX_LENGTH,
    ),
  };
}
