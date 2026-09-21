/**
 * The filter builder — the guarantee that no value we did not check ever
 * reaches the provider (PLAN §3 step 2, PLAN §6 "Closing the ways in").
 *
 * It exists because the provider's own validation is inconsistent, which
 * spikes §3 recorded rather than inferred: a wrong-case `jobLevel` is a 400,
 * an unknown filter key is a 400, but an invalid `jobFunction` value is a
 * silent 200 with a count of zero, and the tech filters are case-insensitive.
 * A silent zero is the dangerous one — it looks like "no market" and would
 * send a strategy to the bin for a typo — so the rule here is stricter than
 * the provider's:
 *
 *   1. a filter key is accepted only if this file declares it, with the kind
 *      of value it takes;
 *   2. an enum value is accepted only if the cached `leadFilterOptions` entry
 *      for that filter lists it EXACTLY, byte for byte;
 *   3. `excludeFilters` accepts only the five documented keys;
 *   4. anything else throws `INVALID` — before the reserve, before the
 *      request, before a single credit moves.
 *
 * The seven free-text filters come back from the provider with an empty
 * `values` array. That is the documented shape, not a failed fetch, so they
 * are declared here as free text and are never checked against the cache.
 */
import type { LeadFilterOption, LeadFilters } from "../../lib/validators";
import { invalid } from "../../lib/validators";

/** What one filter accepts. The kind is about the VALUE's shape; the
 *  provider's own semantics (most scalars are minimums) are noted per group. */
type FilterSpec =
  /** A list of values the cached catalogue must contain exactly. */
  | { kind: "enum_list"; maxItems: number }
  /** A list of free text — matched exactly or by "contains", per filter. */
  | { kind: "text_list"; maxItems: number }
  /** A non-negative integer; on the count filters, a minimum. */
  | { kind: "integer" }
  /** A non-negative number; on the funding and traffic filters, a minimum. */
  | { kind: "number" }
  | { kind: "boolean" }
  /** A short closed set that is NOT in the catalogue (a mode switch). */
  | { kind: "choice"; values: readonly string[] };

/** Default ceiling for an enum list whose catalogue entry states none. */
const DEFAULT_ENUM_MAX_ITEMS = 25;

/** Our own ceiling on a free-text list, whatever the provider allows. */
const TEXT_LIST_MAX_ITEMS = 25;

const KEYWORD_LIST_MAX_ITEMS = 10;

/** An account list is the one legitimately long free-text list. */
const DOMAIN_LIST_MAX_ITEMS = 100;

const FILTER_VALUE_MAX_LENGTH = 200;

/** Largest headcount either end of the range may state. */
const EMPLOYEE_COUNT_MAX = 1_000_000;

/**
 * Every filter this product may send, and nothing else. Names are the
 * provider's, verified against its schema by the T00 spike (spikes §3: all of
 * PLAN §3's signal catalogue exists, zero misses). An unknown key is a 400
 * from the provider, so a name that is merely plausible is never added here.
 */
const FILTER_SPECS: Record<string, FilterSpec> = {
  /* --- person, from the catalogue ----------------------------------- */
  jobLevel: { kind: "enum_list", maxItems: 10 },
  jobFunction: { kind: "enum_list", maxItems: 26 },
  continent: { kind: "enum_list", maxItems: 7 },
  countryRegion: { kind: "enum_list", maxItems: 4 },
  countryName: { kind: "enum_list", maxItems: 25 },
  countryCode: { kind: "enum_list", maxItems: 25 },
  stateName: { kind: "enum_list", maxItems: 25 },
  stateCode: { kind: "enum_list", maxItems: 25 },
  jobLocationCountry: { kind: "enum_list", maxItems: 25 },
  /* --- person, free text -------------------------------------------- */
  jobTitle: { kind: "text_list", maxItems: TEXT_LIST_MAX_ITEMS },
  personHeadline: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  skills: { kind: "text_list", maxItems: TEXT_LIST_MAX_ITEMS },
  languages: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  city: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  jobIsCurrent: { kind: "boolean" },
  /* --- company, from the catalogue ---------------------------------- */
  linkedinIndustry: { kind: "enum_list", maxItems: 20 },
  industrySicCode: { kind: "enum_list", maxItems: 50 },
  industrySicDescription: { kind: "enum_list", maxItems: 50 },
  industryNaicsCode: { kind: "enum_list", maxItems: 50 },
  industryNaicsDescription: { kind: "enum_list", maxItems: 50 },
  revenueBuckets: { kind: "enum_list", maxItems: 6 },
  companyEntityType: { kind: "enum_list", maxItems: 20 },
  companyLegalType: { kind: "enum_list", maxItems: 16 },
  headquartersCountry: { kind: "enum_list", maxItems: 25 },
  locationCountry: { kind: "enum_list", maxItems: 25 },
  /* --- company, free text and scalars -------------------------------- */
  companyName: { kind: "text_list", maxItems: TEXT_LIST_MAX_ITEMS },
  companyNameMode: { kind: "choice", values: ["exact", "contains"] },
  companyHeadline: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  aboutUs: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  domain: { kind: "text_list", maxItems: DOMAIN_LIST_MAX_ITEMS },
  headquartersCity: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  headquartersState: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  employeeCount: { kind: "integer" },
  employeeCountMin: { kind: "integer" },
  employeeCountMax: { kind: "integer" },
  foundedOn: { kind: "integer" },
  revenueMin: { kind: "number" },
  revenueMax: { kind: "number" },
  /* --- funding and growth signals (minimums) -------------------------- */
  lastFundingTypeOrg: { kind: "enum_list", maxItems: 28 },
  lastFundingAmountOrg: { kind: "number" },
  totalFundingAmountOrg: { kind: "number" },
  employeeOnLinkedinGrowthRateOrg: { kind: "number" },
  totalMonthlyTrafficOrg: { kind: "number" },
  monthlyOrganicTrafficOrg: { kind: "number" },
  monthlyPaidTrafficOrg: { kind: "number" },
  monthlyGoogleAdspendOrg: { kind: "number" },
  /* --- tech stack ----------------------------------------------------- */
  crmTechOrg: { kind: "enum_list", maxItems: 6 },
  marketingAutomationTechOrg: { kind: "enum_list", maxItems: 6 },
  salesAutomationTechOrg: { kind: "enum_list", maxItems: 4 },
  abmTechOrg: { kind: "enum_list", maxItems: 6 },
  conversationIntelligenceTechOrg: { kind: "enum_list", maxItems: 5 },
  martechCategoriesOrg: { kind: "enum_list", maxItems: 10 },
  analyticsTechOrg: { kind: "enum_list", maxItems: 5 },
  cmsTechOrg: { kind: "enum_list", maxItems: 14 },
  cloudProviderTechOrg: { kind: "enum_list", maxItems: 6 },
  developmentTechOrg: { kind: "enum_list", maxItems: 5 },
  eCommercePlatformTechOrg: { kind: "enum_list", maxItems: 5 },
  erpTechOrg: { kind: "enum_list", maxItems: 21 },
  emailHostingTechOrg: { kind: "enum_list", maxItems: 2 },
  emailSecurityTechOrg: { kind: "enum_list", maxItems: 9 },
  applicationSecurityTechOrg: { kind: "enum_list", maxItems: 5 },
  cloudSecurityTechOrg: { kind: "enum_list", maxItems: 4 },
  /* --- team shape and hiring (integer minimums, then booleans) -------- */
  salesRoleCountOrg: { kind: "integer" },
  marketingRoleCountOrg: { kind: "integer" },
  engineerRoleCountOrg: { kind: "integer" },
  itRoleCountOrg: { kind: "integer" },
  securityRoleCountOrg: { kind: "integer" },
  devopsRoleCountOrg: { kind: "integer" },
  customerSuccessRoleCountOrg: { kind: "integer" },
  salesOpenRolesCountOrg: { kind: "integer" },
  accountExecutiveOpenRolesCountOrg: { kind: "integer" },
  marketingOpenRolesCountOrg: { kind: "integer" },
  itOpenRolesCountOrg: { kind: "integer" },
  securityOpenRolesCountOrg: { kind: "integer" },
  devopsOpenRolesCountOrg: { kind: "integer" },
  hasCisoOrg: { kind: "boolean" },
  hasCioOrg: { kind: "boolean" },
  hasMobileAppOrg: { kind: "boolean" },
  hasWebAppOrg: { kind: "boolean" },
};

/**
 * The only five keys `excludeFilters` takes (spikes §3). Sending a sixth is a
 * 400, so the exclusion list is checked against this and not against
 * `FILTER_SPECS`.
 */
const EXCLUDE_FILTER_SPECS: Record<string, FilterSpec> = {
  personHeadline: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  companyHeadline: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  aboutUs: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  domain: { kind: "text_list", maxItems: KEYWORD_LIST_MAX_ITEMS },
  jobTitle: { kind: "text_list", maxItems: TEXT_LIST_MAX_ITEMS },
};

/** What the provider's request body carries once every value is checked. */
export type ProviderFilterValue = string | number | boolean | string[];

export type ProviderFilters = Record<string, ProviderFilterValue>;

export type BuiltLeadQuery = {
  filters: ProviderFilters;
  excludeFilters?: Record<string, string[]>;
};

/**
 * Turn a stored strategy's filters into a request body, or refuse.
 *
 * Refusals are `INVALID` domain errors so a caller can let them travel: this
 * runs BEFORE any reserve, so a rejected filter set costs nothing at all —
 * no credits, no hold, no `providerOperations` row, no network call.
 */
export function buildLeadQuery(args: {
  filters: LeadFilters;
  excludeFilters?: LeadFilters;
  options: Record<string, LeadFilterOption>;
}): BuiltLeadQuery {
  const filters: ProviderFilters = {};
  for (const [key, value] of Object.entries(args.filters)) {
    const spec = FILTER_SPECS[key];
    if (spec === undefined) {
      throw invalid(`filters.${key} is not a supported lead filter`);
    }
    filters[key] = checkValue(key, value, spec, args.options);
  }
  if (Object.keys(filters).length === 0) {
    throw invalid("filters must carry at least one value");
  }
  assertHeadcountRange(filters);

  if (args.excludeFilters === undefined) {
    return { filters };
  }
  const excludeFilters: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(args.excludeFilters)) {
    const spec = EXCLUDE_FILTER_SPECS[key];
    if (spec === undefined) {
      throw invalid(`excludeFilters.${key} is not an excludable lead filter`);
    }
    const checked = checkValue(
      `excludeFilters.${key}`,
      value,
      spec,
      args.options,
    );
    // Every exclusion spec is a text list, so this is always a string list.
    excludeFilters[key] = checked as string[];
  }
  return Object.keys(excludeFilters).length === 0
    ? { filters }
    : { filters, excludeFilters };
}

/** A headcount range that runs backwards returns nothing; refuse it here. */
function assertHeadcountRange(filters: ProviderFilters): void {
  const min = filters["employeeCountMin"];
  const max = filters["employeeCountMax"];
  if (typeof min === "number" && typeof max === "number" && min > max) {
    throw invalid("employeeCountMin must not exceed employeeCountMax");
  }
}

function checkValue(
  key: string,
  value: LeadFilters[string],
  spec: FilterSpec,
  options: Record<string, LeadFilterOption>,
): ProviderFilterValue {
  switch (spec.kind) {
    case "boolean":
      if (typeof value !== "boolean") {
        throw invalid(`${key} must be a boolean`);
      }
      return value;
    case "integer":
      return checkNumber(key, value, { integer: true });
    case "number":
      return checkNumber(key, value, { integer: false });
    case "choice": {
      if (typeof value !== "string" || !spec.values.includes(value)) {
        throw invalid(`${key} must be one of ${spec.values.join(", ")}`);
      }
      return value;
    }
    case "text_list":
      return checkList(key, value, spec.maxItems);
    case "enum_list": {
      const list = checkList(key, value, spec.maxItems);
      const option = options[key];
      if (option === undefined) {
        throw invalid(`${key} has no cached allowed values`);
      }
      const maxItems = Math.min(
        spec.maxItems,
        option.maxSelections > 0 ? option.maxSelections : DEFAULT_ENUM_MAX_ITEMS,
      );
      if (list.length > maxItems) {
        throw invalid(`${key} allows at most ${maxItems} values`);
      }
      if (option.values.length === 0) {
        // The catalogue carries no values for this filter, so nothing can be
        // checked — and an unchecked value returns zero rows in silence.
        // Refusing is the honest answer (see `catalog.ts` on the one filter
        // the provider is known to return empty).
        throw invalid(`${key} has no cached allowed values`);
      }
      // EXACT match: the catalogue is case-sensitive and a near-miss is
      // a silent zero, not an error, on several filters.
      const allowed = new Set(option.values);
      for (const entry of list) {
        if (!allowed.has(entry)) {
          throw invalid(`${key} does not allow the value it was given`);
        }
      }
      return list;
    }
  }
}

function checkNumber(
  key: string,
  value: LeadFilters[string],
  opts: { integer: boolean },
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw invalid(`${key} must be a non-negative number`);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw invalid(`${key} must be a whole number`);
  }
  if (key.startsWith("employeeCount") && value > EMPLOYEE_COUNT_MAX) {
    throw invalid(`${key} is out of range`);
  }
  return value;
}

/** A list filter accepts one value or several; both arrive as a list. */
function checkList(
  key: string,
  value: LeadFilters[string],
  maxItems: number,
): string[] {
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list)) {
    throw invalid(`${key} must be a string or a list of strings`);
  }
  if (list.length === 0) {
    throw invalid(`${key} must carry at least one value`);
  }
  if (list.length > maxItems) {
    throw invalid(`${key} allows at most ${maxItems} values`);
  }
  return list.map((entry) => {
    if (typeof entry !== "string") {
      throw invalid(`${key} must be a list of strings`);
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > FILTER_VALUE_MAX_LENGTH) {
      throw invalid(`${key} has a value of an unusable length`);
    }
    return trimmed;
  });
}

/** Whether this filter is one the catalogue must list values for. */
export function isCatalogueFilter(key: string): boolean {
  return FILTER_SPECS[key]?.kind === "enum_list";
}

/** The filter names this product may send — the strategy recommender's
 *  vocabulary (T23) and nothing wider. */
export function supportedFilterKeys(): string[] {
  return Object.keys(FILTER_SPECS);
}

/** The five keys an exclusion list may use. */
export function supportedExcludeFilterKeys(): string[] {
  return Object.keys(EXCLUDE_FILTER_SPECS);
}
