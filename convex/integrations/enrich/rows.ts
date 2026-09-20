/**
 * Provider preview row → our own lead shape.
 *
 * This is where the provider's vocabulary stops (PLAN §4 white-label rule):
 * every field below is named the way `prospects` and `vLeadCompany` name it
 * in `lib/validators/leads.ts`, so nothing outside `integrations/` ever sees
 * a provider field name — and the provider's row id becomes `sourceLeadId`.
 *
 * Provider values are untrusted input: every string is trimmed and cut to the
 * bound the lead vocabulary states, a domain is accepted only if it
 * normalises, and anything missing stays absent rather than becoming an empty
 * string. The preview row nulls almost everything (spikes §3), so absence is
 * the normal case, not an error.
 */
import {
  LEAD_HEADLINE_MAX_LENGTH,
  LEAD_PERSON_NAME_MAX_LENGTH,
  LEAD_SKILLS_MAX,
  normalizeCanonicalDomain,
  PROSPECT_COMPANY_NAME_MAX_LENGTH,
  PROVIDER_RECORD_ID_MAX_LENGTH,
  vLeadCompany,
  vLeadLocation,
} from "../../lib/validators";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/** A person the free search preview described, in our own words. */
export const vSourcedLead = v.object({
  /** The provider's row id — what a reveal is asked for. */
  sourceLeadId: v.string(),
  firstName: v.optional(v.string()),
  /** Masked in a preview row (e.g. `C.`); stored exactly as returned. */
  lastName: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  jobFunction: v.optional(v.string()),
  jobLevel: v.optional(v.string()),
  headline: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  location: v.optional(vLeadLocation),
  skills: v.optional(v.array(v.string())),
  /** The company's mail domain, when the preview states one. Never an
   *  address: a preview row carries no email at all. */
  emailDomain: v.optional(v.string()),
  companyName: v.optional(v.string()),
  canonicalDomain: v.optional(v.string()),
  company: v.optional(vLeadCompany),
});

export type SourcedLead = Infer<typeof vSourcedLead>;

/** How full the rows came back, without naming anybody. The internal probe
 *  returns this instead of rows, so a live check can be run and pasted
 *  without printing a single person's details. */
export const vLeadFieldPresence = v.object({
  rows: v.number(),
  withName: v.number(),
  withJobTitle: v.number(),
  withLinkedin: v.number(),
  withLocation: v.number(),
  withCompanyName: v.number(),
  withCompanyDomain: v.number(),
  withCompanyFacts: v.number(),
  withEmailDomain: v.number(),
});

export type LeadFieldPresence = Infer<typeof vLeadFieldPresence>;

const SKILL_MAX_LENGTH = 80;

const SPECIALTIES_MAX_LENGTH = 500;

const URL_MAX_LENGTH = 500;

const LOCATION_PART_MAX_LENGTH = 120;

const FUNDING_TYPE_MAX_LENGTH = 100;

const FUNDING_DATE_MAX_LENGTH = 40;

const REVENUE_BUCKET_MAX_LENGTH = 40;

const FOUNDED_YEAR_MAX_LENGTH = 10;

const INDUSTRY_MAX_LENGTH = 200;

/** One raw preview row. Only `id` is required; every other key is nullable. */
type PreviewRow = Record<string, unknown>;

/** Map one preview row, or `null` when it carries no usable row id. */
export function toSourcedLead(row: PreviewRow): SourcedLead | null {
  const sourceLeadId = text(row["id"], PROVIDER_RECORD_ID_MAX_LENGTH);
  if (sourceLeadId === undefined) {
    return null;
  }
  const location = presentObject({
    city: text(row["city"], LOCATION_PART_MAX_LENGTH),
    state: text(row["stateName"], LOCATION_PART_MAX_LENGTH),
    country: text(row["countryName"], LOCATION_PART_MAX_LENGTH),
  });
  const company = presentObject({
    linkedinUrl: text(row["orgLinkedinUrl"], URL_MAX_LENGTH),
    logoUrl: text(row["logoUrlOrg"] ?? row["logoUrl"], URL_MAX_LENGTH),
    headline: text(row["companyHeadline"], LEAD_HEADLINE_MAX_LENGTH),
    industry: text(
      row["industrySicDescription"] ?? row["industryNaicsDescription"],
      INDUSTRY_MAX_LENGTH,
    ),
    employeeCount: count(row["employeeCount"]),
    employeeGrowthRate: numeric(row["employeeOnLinkedinGrowthRateOrg"]),
    revenueBucket: text(row["revenue"], REVENUE_BUCKET_MAX_LENGTH),
    foundedYear: text(row["foundedOn"], FOUNDED_YEAR_MAX_LENGTH),
    monthlyTraffic: numeric(row["totalMonthlyTrafficOrg"]),
    totalFunding: numeric(row["totalFundingAmountOrg"]),
    lastFundingType: text(row["lastFundingTypeOrg"], FUNDING_TYPE_MAX_LENGTH),
    lastFundingDate: text(row["lastFundingDateOrg"], FUNDING_DATE_MAX_LENGTH),
    specialties: text(row["specialties"], SPECIALTIES_MAX_LENGTH),
    headquarters: presentObject({
      city: text(row["headquartersCity"], LOCATION_PART_MAX_LENGTH),
      state: text(row["headquartersState"], LOCATION_PART_MAX_LENGTH),
      country: text(row["headquartersCountry"], LOCATION_PART_MAX_LENGTH),
    }),
  });
  const skills = skillList(row["skills"]);
  return {
    sourceLeadId,
    ...present("firstName", text(row["firstName"], LEAD_PERSON_NAME_MAX_LENGTH)),
    ...present("lastName", text(row["lastName"], LEAD_PERSON_NAME_MAX_LENGTH)),
    ...present("jobTitle", text(row["jobTitle"], LEAD_HEADLINE_MAX_LENGTH)),
    ...present("jobFunction", text(row["jobFunction"], INDUSTRY_MAX_LENGTH)),
    ...present("jobLevel", text(row["jobLevel"], INDUSTRY_MAX_LENGTH)),
    ...present(
      "headline",
      text(row["linkedinHeadline"], LEAD_HEADLINE_MAX_LENGTH),
    ),
    ...present("linkedinUrl", text(row["linkedinUrl"], URL_MAX_LENGTH)),
    ...present("location", location),
    ...(skills.length > 0 ? { skills } : {}),
    ...present("emailDomain", domain(row["emailDomain"])),
    ...present(
      "companyName",
      text(row["companyName"], PROSPECT_COMPANY_NAME_MAX_LENGTH),
    ),
    ...present("canonicalDomain", domain(row["domain"])),
    ...present("company", company),
  };
}

/** Field presence across a page of rows — counts only, never values. */
export function fieldPresenceOf(rows: readonly SourcedLead[]): LeadFieldPresence {
  const has = (predicate: (lead: SourcedLead) => boolean): number =>
    rows.filter(predicate).length;
  return {
    rows: rows.length,
    withName: has((lead) => lead.firstName !== undefined),
    withJobTitle: has((lead) => lead.jobTitle !== undefined),
    withLinkedin: has((lead) => lead.linkedinUrl !== undefined),
    withLocation: has((lead) => lead.location !== undefined),
    withCompanyName: has((lead) => lead.companyName !== undefined),
    withCompanyDomain: has((lead) => lead.canonicalDomain !== undefined),
    withCompanyFacts: has((lead) => lead.company !== undefined),
    withEmailDomain: has((lead) => lead.emailDomain !== undefined),
  };
}

/** A trimmed, bounded string, or absent. Empty is absent, never `""`. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).slice(0, max);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function count(value: unknown): number | undefined {
  const parsed = numeric(value);
  return parsed === undefined ? undefined : Math.max(0, Math.trunc(parsed));
}

/** A host we would be willing to research, or absent. */
function domain(value: unknown): string | undefined {
  const raw = text(value, 300);
  if (raw === undefined) {
    return undefined;
  }
  try {
    return normalizeCanonicalDomain(raw);
  } catch {
    return undefined;
  }
}

/** The provider joins skills into one comma-separated string. */
function skillList(value: unknown): string[] {
  const raw = text(value, 2_000);
  if (raw === undefined) {
    return [];
  }
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const skill = part.trim().slice(0, SKILL_MAX_LENGTH);
    if (skill.length > 0) {
      seen.add(skill);
    }
    if (seen.size >= LEAD_SKILLS_MAX) {
      break;
    }
  }
  return [...seen];
}

/** `{ key: value }` when the value exists, `{}` when it does not — the shape
 *  `exactOptionalPropertyTypes` wants at every optional member. */
function present<K extends string, T>(
  key: K,
  value: T | undefined,
): Record<K, T> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, T>);
}

/** An object with its absent members dropped, or absent when nothing is
 *  left — a company with no known facts is no company block at all. */
function presentObject<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]?: NonNullable<T[K]> } | undefined {
  const entries = Object.entries(value).filter(
    ([, member]) => member !== undefined,
  );
  return entries.length === 0
    ? undefined
    : (Object.fromEntries(entries) as { [K in keyof T]?: NonNullable<T[K]> });
}
