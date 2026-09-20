/**
 * The ICP's vocabulary: every value a chip on references 06–08 may carry, and
 * where each one comes from (PLAN §3 step 2, §7).
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
 *
 * Checking a value against these lists is `icpModel.ts`.
 */
import type { QueryCtx } from "../_generated/server";
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
