/**
 * The ICP's vocabulary and the one place a value is checked against it
 * (PLAN §3 step 2, §7).
 *
 * Four of the seven ICP lists are closed, and each is closed in a different
 * way:
 *
 *   industries, locations, companyTypes  the lead-search catalogue's own
 *     values, cached in `leadFilterOptions`. They are case-sensitive and a
 *     near-miss is a SILENT ZERO — the search succeeds and returns nobody —
 *     so a value is accepted only when the cache lists it byte for byte.
 *
 *   companySizes  our own headcount bands. The catalogue has no size filter:
 *     the provider takes `employeeCountMin` / `employeeCountMax`, so the bands
 *     are declared here as the vocabulary the user picks from and T23 compiles
 *     them to that pair.
 *
 * Job titles and the two exclusion lists are genuinely free text — the
 * provider's title and keyword filters are — so they are only bounded.
 *
 * An EMPTY list means "all of them" for a group, never "none of them": a
 * filter with no values is simply not sent, which is what "All industries" on
 * reference 07 has to mean for the search to return anything at all.
 */
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  boundedString,
  boundedStringList,
  COMPANY_PAIN_POINTS_MAX_LENGTH,
  computeResultDigest,
  ICP_LIST_MAX_ITEMS,
  ICP_VALUE_MAX_LENGTH,
  invalid,
} from "../lib/validators";
import type { AgentIcp, LeadFilterOption } from "../lib/validators";

/* ------------------------------------------------------------------ */
/* Which catalogue filter each closed group draws on                    */
/* ------------------------------------------------------------------ */

/** The catalogue's industry list (454 values, `maxSelections` 20). */
const INDUSTRY_FILTER = "linkedinIndustry";

/** Locations are offered at two grains: the seven continents first, then the
 *  countries, because an ICP is usually a region and occasionally one market
 *  (reference 07 shows "North America" and "Europe"). Both are catalogue
 *  values, so T23 can tell them apart by asking which list a value is in. */
const LOCATION_FILTERS = ["continent", "countryName"] as const;

/** The catalogue's organisation-kind list (10 values). */
const COMPANY_TYPE_FILTER = "companyEntityType";

/* ------------------------------------------------------------------ */
/* Company size — our own bands                                         */
/* ------------------------------------------------------------------ */

/**
 * The headcount bands of reference 07, as the one typed constant that owns
 * them. `value` is what is stored on the agent, `min`/`max` is what T23 sends
 * as `employeeCountMin` / `employeeCountMax`; an absent `max` is open-ended.
 */
export const COMPANY_SIZE_BANDS = [
  { value: "1-10", label: "1–10 employees", min: 1, max: 10 },
  { value: "11-50", label: "11–50 employees", min: 11, max: 50 },
  { value: "51-200", label: "51–200 employees", min: 51, max: 200 },
  { value: "201-500", label: "201–500 employees", min: 201, max: 500 },
  { value: "501-1000", label: "501–1000 employees", min: 501, max: 1_000 },
  { value: "1001-5000", label: "1001–5000 employees", min: 1_001, max: 5_000 },
  {
    value: "5001-10000",
    label: "5001–10000 employees",
    min: 5_001,
    max: 10_000,
  },
  { value: "10000+", label: "10000+ employees", min: 10_001 },
] as const satisfies readonly {
  value: string;
  label: string;
  min: number;
  max?: number;
}[];

export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number];

/** The band with this stored value, or `undefined`. */
export function companySizeBand(value: string): CompanySizeBand | undefined {
  return COMPANY_SIZE_BANDS.find((band) => band.value === value);
}

/* ------------------------------------------------------------------ */
/* Who to leave out — our own vocabulary                                */
/* ------------------------------------------------------------------ */

/**
 * The kinds of person who look like a match and never buy (reference 08).
 *
 * A closed list rather than free text, because each option has to MEAN
 * something to a search: `keywords` are the words T23 puts into the
 * exclusion filters, and a phrase the user typed would exclude nothing. The
 * competitor names and keywords on the same screen stay free text — those
 * really are just words to avoid.
 */
export const ICP_EXCLUDE_PROFILE_OPTIONS = [
  {
    value: "service_providers",
    label: "Service providers, freelancers, consultants",
    keywords: ["Freelance", "Consultant", "Agency", "Contractor"],
  },
  {
    value: "recruiters",
    label: "Recruiters and staffing agencies",
    keywords: ["Recruiter", "Recruiting", "Staffing", "Talent Acquisition"],
  },
  {
    value: "students",
    label: "Students, interns and job seekers",
    keywords: ["Student", "Intern", "Seeking", "Open to work"],
  },
  {
    value: "competitors",
    label: "Companies selling what you sell",
    keywords: [],
  },
] as const satisfies readonly {
  value: string;
  label: string;
  keywords: readonly string[];
}[];

export type IcpExcludeProfileOption =
  (typeof ICP_EXCLUDE_PROFILE_OPTIONS)[number];

/** The exclusion option with this stored value, or `undefined`. */
export function excludeProfileOption(
  value: string,
): IcpExcludeProfileOption | undefined {
  return ICP_EXCLUDE_PROFILE_OPTIONS.find((option) => option.value === value);
}

/* ------------------------------------------------------------------ */
/* How long each list may be                                            */
/* ------------------------------------------------------------------ */

/**
 * The ceiling per group, in the units the provider accepts downstream:
 * `linkedinIndustry` takes 20 values, `jobTitle` 25, the exclusion lists 10
 * (`integrations/enrich/filters.ts`). A list longer than the filter allows
 * would be refused at search time, which is far too late to tell the user.
 */
export const ICP_GROUP_MAX_ITEMS = {
  jobTitles: 25,
  industries: 20,
  locations: 10,
  companyTypes: 10,
  companySizes: COMPANY_SIZE_BANDS.length,
  excludeProfiles: 10,
  excludeKeywords: 10,
} as const satisfies Record<keyof AgentIcp, number>;

/* ------------------------------------------------------------------ */
/* The option lists the three screens offer                             */
/* ------------------------------------------------------------------ */

/**
 * The neutral vocabularies onboarding dot 2 shows. No filter names, no
 * catalogue structure, no provider wording — just the values a chip may carry,
 * which is all three screens need.
 */
export type IcpOptionLists = {
  industries: string[];
  /** Continents first, then countries; both are single-select chips. */
  locations: string[];
  /** How many of `locations` are the broad regions. */
  locationRegionCount: number;
  companyTypes: string[];
  companySizes: { value: string; label: string }[];
  excludeProfiles: { value: string; label: string }[];
};

/** Our own two vocabularies, in the shape the screens render them. */
const OWN_OPTION_LISTS = {
  companySizes: COMPANY_SIZE_BANDS.map((band) => ({
    value: band.value,
    label: band.label,
  })),
  excludeProfiles: ICP_EXCLUDE_PROFILE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  })),
};

function optionValues(
  options: Record<string, LeadFilterOption>,
  filter: string,
): readonly string[] {
  return options[filter]?.values ?? [];
}

/** Build the option lists from a cached catalogue. */
export function icpOptionLists(
  options: Record<string, LeadFilterOption>,
): IcpOptionLists {
  const regions = [...optionValues(options, LOCATION_FILTERS[0])];
  const countries = optionValues(options, LOCATION_FILTERS[1]).filter(
    (country) => !regions.includes(country),
  );
  return {
    industries: [...optionValues(options, INDUSTRY_FILTER)],
    locations: [...regions, ...countries],
    locationRegionCount: regions.length,
    companyTypes: [...optionValues(options, COMPANY_TYPE_FILTER)],
    ...OWN_OPTION_LISTS,
  };
}

/**
 * The option lists a reader of the cached catalogue can offer, or `null` when
 * the catalogue has never been fetched.
 *
 * It reads the `leadFilterOptions` singleton the same way
 * `agents/filterOptions.ts` does — newest row wins — because a public query
 * cannot call that file's `internalQuery`, and the alternative (offering the
 * screens a list nobody checked) is the exact failure mode PLAN §3 step 2
 * exists to prevent.
 */
export async function readIcpOptionLists(
  ctx: QueryCtx,
): Promise<IcpOptionLists | null> {
  const row = await ctx.db
    .query("leadFilterOptions")
    .withIndex("by_fetchedAt")
    .order("desc")
    .first();
  return row === null ? null : icpOptionLists(row.options);
}

/** The lists with nothing in them — what the screens get before the catalogue
 *  has ever been fetched, so they can say so instead of rendering blanks. */
export const EMPTY_ICP_OPTION_LISTS: IcpOptionLists = {
  industries: [],
  locations: [],
  locationRegionCount: 0,
  companyTypes: [],
  ...OWN_OPTION_LISTS,
};

/* ------------------------------------------------------------------ */
/* Checking one ICP                                                     */
/* ------------------------------------------------------------------ */

/** Trim, drop blanks, drop case-insensitive duplicates, keep the order. */
function tidy(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const lower = trimmed.toLocaleLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    kept.push(trimmed);
  }
  return kept;
}

function freeTextGroup(
  values: readonly string[],
  field: keyof AgentIcp,
): string[] {
  return boundedStringList(tidy(values), field, {
    maxItems: Math.min(ICP_GROUP_MAX_ITEMS[field], ICP_LIST_MAX_ITEMS),
    itemMax: ICP_VALUE_MAX_LENGTH,
  });
}

/**
 * A closed group, checked against the values it may carry.
 *
 * `strict` is the difference between a user's edit and a model's answer. An
 * edit that names a value the catalogue does not have is a bug or an attempt,
 * and is REFUSED — the screens only ever offer catalogue values, so nothing
 * legitimate reaches this with a value that is not one. A model's answer is
 * merely filtered: a paid generation must not be thrown away because one of
 * six industries came back misspelled.
 */
function closedGroup(
  values: readonly string[],
  field: keyof AgentIcp,
  allowed: readonly string[],
  strict: boolean,
): string[] {
  const tidied = tidy(values);
  const permitted = new Set(allowed);
  const kept: string[] = [];
  for (const value of tidied) {
    if (!permitted.has(value)) {
      if (strict) {
        throw invalid(`${field} does not allow one of the values it was given`);
      }
      continue;
    }
    kept.push(value);
  }
  return kept.slice(0, ICP_GROUP_MAX_ITEMS[field]);
}

export type NormalizeIcpArgs = {
  icp: AgentIcp;
  options: IcpOptionLists;
  /** `true` for a user edit, `false` for a generated answer. */
  strict: boolean;
};

/**
 * The one door an ICP goes through before it is written, whoever produced it.
 *
 * Nothing else in this domain may write `agents.icp`: the closed groups are
 * the whole reason the product does not silently search for nobody.
 */
export function normalizeIcp(args: NormalizeIcpArgs): AgentIcp {
  const { icp, options, strict } = args;
  return {
    jobTitles: freeTextGroup(icp.jobTitles, "jobTitles"),
    industries: closedGroup(
      icp.industries,
      "industries",
      options.industries,
      strict,
    ),
    locations: closedGroup(icp.locations, "locations", options.locations, strict),
    companyTypes: closedGroup(
      icp.companyTypes,
      "companyTypes",
      options.companyTypes,
      strict,
    ),
    companySizes: closedGroup(
      icp.companySizes,
      "companySizes",
      options.companySizes.map((band) => band.value),
      strict,
    ),
    excludeProfiles: closedGroup(
      icp.excludeProfiles,
      "excludeProfiles",
      options.excludeProfiles.map((option) => option.value),
      strict,
    ),
    excludeKeywords: freeTextGroup(icp.excludeKeywords, "excludeKeywords"),
  };
}

/**
 * Turn the labels a generation answered with back into stored values.
 *
 * Company sizes and profile exclusions are OUR vocabulary, and the model is
 * shown their labels — "11–50 employees" reads like a choice, `11-50` reads
 * like a bug. It stores the value, so the two are reconciled here, once,
 * before anything is checked. A value the model happened to answer with
 * already passes through, and anything else is left alone for `normalizeIcp`
 * to drop.
 */
export function resolveGeneratedLabels(
  icp: AgentIcp,
  options: IcpOptionLists,
): AgentIcp {
  const resolve = (
    values: readonly string[],
    list: readonly { value: string; label: string }[],
  ): string[] =>
    values.map((entry) => {
      const lower = entry.trim().toLocaleLowerCase();
      const match = list.find(
        (option) =>
          option.value.toLocaleLowerCase() === lower ||
          option.label.toLocaleLowerCase() === lower,
      );
      return match?.value ?? entry;
    });
  return {
    ...icp,
    companySizes: resolve(icp.companySizes, options.companySizes),
    excludeProfiles: resolve(icp.excludeProfiles, options.excludeProfiles),
  };
}

/** The pain points a generation produced, bounded for the profile. */
export function boundedPainPoints(value: string): string {
  return boundedString(value, "painPoints", {
    max: COMPANY_PAIN_POINTS_MAX_LENGTH,
  });
}

/* ------------------------------------------------------------------ */
/* Comparing and emptiness                                              */
/* ------------------------------------------------------------------ */

const ICP_GROUPS = [
  "jobTitles",
  "industries",
  "locations",
  "companyTypes",
  "companySizes",
  "excludeProfiles",
  "excludeKeywords",
] as const satisfies readonly (keyof AgentIcp)[];

/** True when every list is empty — the state a draft agent starts in, and the
 *  condition for generating one automatically. */
export function icpIsEmpty(icp: AgentIcp): boolean {
  return ICP_GROUPS.every((group) => icp[group].length === 0);
}

/** True when nothing about the ICP changed, so `revision` must not move. */
export function sameIcp(a: AgentIcp, b: AgentIcp): boolean {
  return ICP_GROUPS.every(
    (group) =>
      a[group].length === b[group].length &&
      a[group].every((value, index) => value === b[group][index]),
  );
}

/* ------------------------------------------------------------------ */
/* What one generation run pays under                                   */
/* ------------------------------------------------------------------ */

/**
 * The key one run spends under. It always carries `startedAt`, so Retry and
 * Regenerate really re-ask the model: a replayed AI operation carries no
 * object at all (`ai/run.ts`), so reusing a key would make every retry fail
 * identically and for free.
 */
export async function icpOperationKey(args: {
  workspaceId: Id<"workspaces">;
  startedAt: number;
}): Promise<string> {
  // Hashed rather than concatenated so the key cannot grow past
  // `OPERATION_KEY_MAX` once the action prefix is added.
  const digest = await computeResultDigest({
    workspaceId: args.workspaceId,
    startedAt: args.startedAt,
  });
  return `${args.workspaceId}:${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

/**
 * How long a `generating` status may sit before a new run may replace it.
 *
 * The internal action always reports back, so this only covers a deployment
 * that lost the scheduled call. Without it the user would face a screen that
 * never stops loading and a Retry that is refused forever.
 */
export const ICP_GENERATION_STALE_AFTER_MS = 5 * 60_000;
