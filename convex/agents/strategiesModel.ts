/**
 * Search strategies, in plain typed functions (PLAN §3 steps 3–5).
 *
 * The rule this file exists to keep: THE CORE HALF OF EVERY SEARCH IS
 * COMPILED HERE, NOT BY THE MODEL. Job titles, industries, locations, sizes
 * and company types are the user's own answers from dot 2, and they are
 * turned into provider filters by code that can be read — a model that
 * misremembered one of them would silently change who the agent contacts.
 * The model only ever writes the signal half, and even that is re-checked
 * against the cached catalogue before anything is stored (`filterOptions`).
 *
 * The second rule: RELAXING IS PLAIN CODE TOO. PLAN §3 step 4 calls for one
 * automatic pass when a strategy matches nobody, and its moves are already
 * written down there — drop `jobTitle` for `jobLevel` + `jobFunction`, widen
 * size, widen geography. Every one of those is a deterministic edit of a
 * filter set, so the pass costs a free count and no credits at all.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  EXCLUDE_FILTER_KEYS,
  signalFilterSpec,
} from "../ai/recommendStrategies";
import type { StrategyFilterEntry } from "../ai/recommendStrategies";
import {
  AGENT_KEYWORD_MAX_LENGTH,
  AGENT_KEYWORDS_MAX,
  computeResultDigest,
} from "../lib/validators";
import type {
  AgentIcp,
  LeadFilterOption,
  LeadFilters,
  SignalKind,
} from "../lib/validators";
import { companySizeBand, excludeProfileOption } from "./icpVocabulary";

/* ------------------------------------------------------------------ */
/* What counts as a usable strategy                                     */
/* ------------------------------------------------------------------ */

/**
 * Fewer matches than this and a strategy is not worth a page of search: the
 * run buys 25 rows a page, so a handful of matches is one page and then
 * nothing. Below it, the relax pass runs.
 */
export const STRATEGY_MIN_USEFUL_MATCHES = 25;

/**
 * More matches than this and the signal has stopped meaning anything — the
 * agent would be contacting an undifferentiated market. Above it, the tighten
 * pass runs. Well below the provider's own 500,000 cap on purpose.
 */
export const STRATEGY_TOO_MANY_MATCHES = 200_000;

/** What one tighten pass multiplies a numeric signal minimum by. */
export const STRATEGY_TIGHTEN_FACTOR = 5;

/** A strategy may be switched on only when it actually matches someone. */
export function strategyIsSelectable(matchCount: number): boolean {
  return matchCount > 0;
}

/**
 * How long a `generating` status may sit before a new run may replace it.
 * The action always reports back, so this only covers a deployment that lost
 * the scheduled call — without it the screen would load forever.
 */
export const STRATEGY_GENERATION_STALE_AFTER_MS = 5 * 60_000;

/* ------------------------------------------------------------------ */
/* The key one run pays under                                           */
/* ------------------------------------------------------------------ */

/**
 * The idempotency key one paid run spends under. It carries `startedAt` and
 * the purpose, so Regenerate really re-asks the model and a keyword run never
 * replays a recommendation's answer (a replayed AI operation carries no
 * object at all — `ai/run.ts`).
 */
export async function strategyOperationKey(args: {
  orgId: Id<"orgs">;
  purpose: "signals" | "keywords";
  startedAt: number;
}): Promise<string> {
  const digest = await computeResultDigest({
    orgId: args.orgId,
    purpose: args.purpose,
    startedAt: args.startedAt,
  });
  const short = digest.slice("sha256:".length, "sha256:".length + 16);
  return `${args.orgId}:${args.purpose}:${short}`;
}

/* ------------------------------------------------------------------ */
/* The cached catalogue                                                 */
/* ------------------------------------------------------------------ */

/**
 * The newest cached filter catalogue, or `null` when it has never been
 * fetched. Read the same way `agents/filterOptions.ts` and `icpVocabulary.ts`
 * read it — newest row wins — because those are `internalQuery`s and this is
 * a plain helper the domain's own queries call.
 */
export async function readFilterCatalogue(
  ctx: QueryCtx,
): Promise<Record<string, LeadFilterOption> | null> {
  const row = await ctx.db
    .query("leadFilterOptions")
    .withIndex("by_fetchedAt")
    .order("desc")
    .first();
  return row === null ? null : row.options;
}

function catalogueValues(
  options: Record<string, LeadFilterOption>,
  filter: string,
): readonly string[] {
  return options[filter]?.values ?? [];
}

/* ------------------------------------------------------------------ */
/* The core half: the ideal customer as provider filters                */
/* ------------------------------------------------------------------ */

/** Ceilings the provider states per filter (`integrations/enrich/filters.ts`);
 *  a longer list is refused at search time, far too late to tell anyone. */
const CORE_LIST_MAX = {
  jobTitle: 25,
  linkedinIndustry: 20,
  continent: 7,
  countryName: 25,
  companyEntityType: 10,
} as const;

/** Words in an exclusion or keyword list, per filter. */
const KEYWORD_LIST_MAX = 10;

function kept(
  values: readonly string[],
  allowed: readonly string[],
  max: number,
): string[] {
  const permitted = new Set(allowed);
  return values.filter((value) => permitted.has(value)).slice(0, max);
}

/**
 * The ideal customer as a filter set — the half of every strategy that is
 * never the model's to write.
 *
 * A value the catalogue no longer lists is dropped rather than sent: it would
 * be refused by the builder and take the whole strategy with it, and the user
 * did not do anything wrong by having picked it last week.
 */
export function compileCoreFilters(args: {
  icp: AgentIcp;
  options: Record<string, LeadFilterOption>;
}): LeadFilters {
  const { icp, options } = args;
  const filters: LeadFilters = {};

  const jobTitles = icp.jobTitles.slice(0, CORE_LIST_MAX.jobTitle);
  if (jobTitles.length > 0) {
    filters["jobTitle"] = jobTitles;
  }

  const industries = kept(
    icp.industries,
    catalogueValues(options, "linkedinIndustry"),
    CORE_LIST_MAX.linkedinIndustry,
  );
  if (industries.length > 0) {
    filters["linkedinIndustry"] = industries;
  }

  // Locations are offered at two grains (`icpVocabulary.ts`): a continent or
  // a country. Which one a stored value is, is decided by which catalogue
  // list carries it — never by guessing at its spelling.
  const continents = kept(
    icp.locations,
    catalogueValues(options, "continent"),
    CORE_LIST_MAX.continent,
  );
  if (continents.length > 0) {
    filters["continent"] = continents;
  }
  const countries = kept(
    icp.locations.filter((value) => !continents.includes(value)),
    catalogueValues(options, "countryName"),
    CORE_LIST_MAX.countryName,
  );
  if (countries.length > 0) {
    filters["countryName"] = countries;
  }

  const companyTypes = kept(
    icp.companyTypes,
    catalogueValues(options, "companyEntityType"),
    CORE_LIST_MAX.companyEntityType,
  );
  if (companyTypes.length > 0) {
    filters["companyEntityType"] = companyTypes;
  }

  // Headcount is our own vocabulary: the catalogue has no size filter, so the
  // selected bands become the one range that spans them.
  const bands = icp.companySizes
    .map((value) => companySizeBand(value))
    .filter((band): band is NonNullable<typeof band> => band !== undefined);
  if (bands.length > 0) {
    filters["employeeCountMin"] = Math.min(...bands.map((band) => band.min));
    // An open-ended band ("10000+") means there is no upper bound at all.
    const openEnded = bands.some((band) => !("max" in band));
    if (!openEnded) {
      filters["employeeCountMax"] = Math.max(
        ...bands.map((band) => ("max" in band ? band.max : band.min)),
      );
    }
  }

  return filters;
}

/**
 * The people and companies to leave out, from the ICP's own two lists
 * (reference 08). Profile exclusions carry the keywords their option declares;
 * the competitor list is matched against the company's own headline.
 */
export function compileExcludeFilters(icp: AgentIcp): LeadFilters {
  const excludeFilters: LeadFilters = {};

  const profileKeywords: string[] = [];
  for (const value of icp.excludeProfiles) {
    const option = excludeProfileOption(value);
    if (option === undefined) {
      continue;
    }
    for (const keyword of option.keywords) {
      if (!profileKeywords.includes(keyword)) {
        profileKeywords.push(keyword);
      }
    }
  }
  if (profileKeywords.length > 0) {
    excludeFilters["personHeadline"] = profileKeywords.slice(
      0,
      KEYWORD_LIST_MAX,
    );
  }

  const competitors = icp.excludeKeywords.slice(0, KEYWORD_LIST_MAX);
  if (competitors.length > 0) {
    excludeFilters["companyHeadline"] = competitors;
  }

  return excludeFilters;
}

/* ------------------------------------------------------------------ */
/* The keyword strategy                                                 */
/* ------------------------------------------------------------------ */

/**
 * Where the user's keywords are looked for, best place first.
 *
 * The three contains-filters are alternatives, not a set: the provider ANDs
 * different filter names, so asking for the same phrase in a person's
 * headline AND their company's headline AND its about text matches almost
 * nobody. So the confirm step counts them in this order and keeps the first
 * that finds people — all free (PLAN §3 step 4).
 */
export function keywordFilterLadder(keywords: readonly string[]): LeadFilters[] {
  const words = keywords.slice(0, KEYWORD_LIST_MAX);
  if (words.length === 0) {
    return [];
  }
  return [
    { personHeadline: words },
    { companyHeadline: words },
    { aboutUs: words },
  ];
}

/** Trim, drop blanks and case-insensitive duplicates, bound to what the agent
 *  stores. The one door `keywords` goes through, whoever typed them. */
export function boundedKeywords(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim().slice(0, AGENT_KEYWORD_MAX_LENGTH);
    if (trimmed.length === 0) {
      continue;
    }
    const lower = trimmed.toLocaleLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    out.push(trimmed);
    if (out.length >= AGENT_KEYWORDS_MAX) {
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The signal half: the model's answer, checked                         */
/* ------------------------------------------------------------------ */

/**
 * Turn the model's filter LIST into the record a strategy stores, keeping
 * only entries this product declared for that signal.
 *
 * A key we never offered, a value of the wrong kind or a negative minimum is
 * dropped silently: the strategy keeps its other filter, or loses its signal
 * half and is dropped by the caller. Nothing half-understood is stored.
 */
export function entriesToSignalFilters(
  entries: readonly StrategyFilterEntry[],
  signalKind: SignalKind,
): LeadFilters {
  const filters: LeadFilters = {};
  for (const entry of entries) {
    const spec = signalFilterSpec(entry.key);
    if (spec === undefined || spec.signalKind !== signalKind) {
      continue;
    }
    if (spec.kind === "values") {
      const values = (entry.values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (values.length > 0) {
        filters[entry.key] = values;
      }
      continue;
    }
    if (spec.kind === "atLeast") {
      const value = entry.atLeast;
      // A minimum of zero matches everyone, so it is not a signal at all —
      // it would put a card on screen that says nothing about anybody.
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        filters[entry.key] = value;
      }
      continue;
    }
    if (typeof entry.flag === "boolean") {
      filters[entry.key] = entry.flag;
    }
  }
  return filters;
}

/** The model's extra exclusions, from the five keys an exclusion list takes. */
export function entriesToExcludeFilters(
  entries: readonly StrategyFilterEntry[],
): LeadFilters {
  const filters: LeadFilters = {};
  for (const entry of entries) {
    if (!EXCLUDE_FILTER_KEYS.includes(entry.key)) {
      continue;
    }
    const values = (entry.values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .slice(0, KEYWORD_LIST_MAX);
    if (values.length > 0) {
      filters[entry.key] = values;
    }
  }
  return filters;
}

/** The core half wins every collision: the model may add to the ideal
 *  customer, never overwrite it. */
export function mergeFilters(core: LeadFilters, extra: LeadFilters): LeadFilters {
  return { ...extra, ...core };
}

/** Merge two exclusion sets, keeping each key's values inside the ceiling. */
export function mergeExcludeFilters(
  base: LeadFilters,
  extra: LeadFilters,
): LeadFilters {
  const merged: LeadFilters = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const existing = merged[key];
    const combined = Array.isArray(existing) ? [...existing, ...value] : value;
    merged[key] = [...new Set(combined)].slice(0, KEYWORD_LIST_MAX);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* One relax pass, in plain code                                        */
/* ------------------------------------------------------------------ */

/** Cues that place a written job title on the provider's six-value ladder.
 *  Checked longest first so "vice president" never reads as "president". */
const JOB_LEVEL_CUES: readonly { level: string; cues: readonly string[] }[] = [
  {
    level: "C-Team",
    cues: [
      "chief",
      "founder",
      "co-founder",
      "owner",
      "president",
      "partner",
      "ceo",
      "cto",
      "cmo",
      "cfo",
      "coo",
      "cio",
      "ciso",
      "cro",
    ],
  },
  { level: "VP", cues: ["vp", "vice president", "svp", "evp"] },
  { level: "Director", cues: ["director", "head of", "head"] },
  { level: "Manager", cues: ["manager", "lead", "principal"] },
  {
    level: "Staff",
    cues: ["specialist", "analyst", "associate", "coordinator", "engineer"],
  },
];

function words(text: string): string[] {
  return text.toLocaleLowerCase().match(/[a-z]{3,}/g) ?? [];
}

/**
 * The broader way to say who the ICP's job titles are: the provider's own
 * seniority ladder and job-function list.
 *
 * PLAN §3 step 4 names this as the first relax move, because `jobTitle` is a
 * contains-match on free text and is by far the narrowest filter in a core
 * set. Both lists are read from the cached catalogue, so a value that does
 * not exist can never come out of here.
 */
export function inferRoleFilters(args: {
  jobTitles: readonly string[];
  options: Record<string, LeadFilterOption>;
}): LeadFilters {
  const titles = args.jobTitles.join(" ").toLocaleLowerCase();
  if (titles.trim().length === 0) {
    return {};
  }
  const filters: LeadFilters = {};

  const allowedLevels = new Set(catalogueValues(args.options, "jobLevel"));
  const levels = JOB_LEVEL_CUES.filter(
    (entry) =>
      allowedLevels.has(entry.level) &&
      entry.cues.some((cue) => titles.includes(cue)),
  ).map((entry) => entry.level);
  if (levels.length > 0) {
    filters["jobLevel"] = levels;
  }

  const titleWords = new Set(words(titles));
  const functions = catalogueValues(args.options, "jobFunction").filter(
    (value) => words(value).some((word) => titleWords.has(word)),
  );
  if (functions.length > 0) {
    filters["jobFunction"] = functions.slice(0, 26);
  }

  return filters;
}

/** A filter set with these keys removed. */
function without(filters: LeadFilters, keys: readonly string[]): LeadFilters {
  const next: LeadFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!keys.includes(key)) {
      next[key] = value;
    }
  }
  return next;
}

/**
 * The single widening move to try when a strategy matches too few people, or
 * `null` when there is nothing left to widen.
 *
 * The order is PLAN §3 step 4's: roles first (the narrowest filter and the
 * one with an exact broader form), then headcount, then geography, then the
 * kind of organisation. Industry is never dropped — an agent searching every
 * industry is not the customer the user described.
 */
export function relaxFilters(
  filters: LeadFilters,
  roleFilters: LeadFilters,
): LeadFilters | null {
  if (filters["jobTitle"] !== undefined && Object.keys(roleFilters).length > 0) {
    return { ...without(filters, ["jobTitle"]), ...roleFilters };
  }
  if (
    filters["employeeCountMin"] !== undefined ||
    filters["employeeCountMax"] !== undefined
  ) {
    return without(filters, ["employeeCountMin", "employeeCountMax"]);
  }
  if (filters["countryName"] !== undefined) {
    // The country goes whether or not a continent was picked alongside it: a
    // country-only ICP is the commonest one there is, and requiring both
    // filters left it with no geography rung at all. What remains — the
    // continent if there was one, everywhere if there was not — is still the
    // customer the user described, in more places than one country.
    return without(filters, ["countryName"]);
  }
  if (filters["companyEntityType"] !== undefined) {
    return without(filters, ["companyEntityType"]);
  }
  return null;
}

/**
 * The single narrowing move for a strategy that matches an undifferentiated
 * market, or `null` when there is none.
 *
 * Only the SIGNAL half is ever tightened. The core half is the customer the
 * user described on dot 2, and narrowing it here would quietly overrule an
 * answer they gave us.
 */
export function tightenFilters(filters: LeadFilters): LeadFilters | null {
  for (const [key, value] of Object.entries(filters)) {
    const spec = signalFilterSpec(key);
    if (spec?.kind !== "atLeast" || typeof value !== "number") {
      continue;
    }
    // Every stored minimum is greater than zero (`entriesToSignalFilters`),
    // so multiplying always raises the bar.
    return { ...filters, [key]: value * STRATEGY_TIGHTEN_FACTOR };
  }
  // Second rung: a values signal is an OR across everything in its list, so
  // the list itself is the width. The model writes them best-first, so the
  // back half is what goes — the signal keeps meaning the same thing, of
  // fewer companies. Behind the numeric rung on purpose: raising a minimum
  // takes no value away from the card's own promise.
  for (const [key, value] of Object.entries(filters)) {
    const spec = signalFilterSpec(key);
    if (spec?.kind !== "values" || !Array.isArray(value) || value.length < 2) {
      continue;
    }
    return { ...filters, [key]: value.slice(0, Math.ceil(value.length / 2)) };
  }
  // A single-value list and a flag are already as narrow as they go — a flag
  // has no smaller form than `true` — so there is nothing left to tighten.
  return null;
}

/* ------------------------------------------------------------------ */
/* Words on the cards                                                   */
/* ------------------------------------------------------------------ */

/** The always-present strategy, when the model failed to name it. PLAN §3:
 *  "Best-fit roles in your ICP" — always present. */
export const CORE_STRATEGY_TITLE = "Best-fit people in your ideal customer";

export const CORE_STRATEGY_RATIONALE =
  "Everyone who matches the customer you described, whether or not anything " +
  "else is happening at their company right now.";

/** The keyword strategy's card, built from the words the user picked. */
export function keywordStrategyTitle(keywords: readonly string[]): string {
  const first = keywords[0];
  return first === undefined
    ? "People talking about your topics"
    : `People talking about "${first}"${keywords.length > 1 ? " and more" : ""}`;
}

export const KEYWORD_STRATEGY_RATIONALE =
  "They write about this themselves, so the problem you solve is already on " +
  "their mind.";
