/**
 * The ideal customer profile — the AI half of onboarding dot 2 (PLAN §3,
 * flow.html step 2, references 06–08).
 *
 * Like every file in `convex/ai/`, this one holds ONE task's prompt and the
 * shape of its answer and nothing else: no `ctx`, no database, no domain
 * import, no provider call. `convex/agents/icp.ts` brings the company profile
 * and the allowed values, and persists what comes back.
 *
 * The thing this prompt has to get right is that three of the seven lists are
 * NOT free text. Industries, locations and company types are the lead-search
 * catalogue's own values, which are case-sensitive and whose near-miss is a
 * silent zero rather than an error (PLAN §3 step 2, spikes §3). So the model is
 * handed the allowed values and told to copy them exactly — and the domain
 * re-checks every one against the cache before it writes, because a prompt is
 * never a guarantee.
 */
import { COMPANY_PAIN_POINTS_MAX_LENGTH } from "../lib/validators";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/** What the prompt asks for, and what `boundIcpGeneration` clamps to. The
 *  hard ceilings live in `lib/validators/agents.ts`; these are the numbers
 *  that make a chip row on reference 06–08 readable. */
export const ICP_JOB_TITLES_MIN = 3;
export const ICP_JOB_TITLES_MAX = 8;
export const ICP_INDUSTRIES_MAX = 6;
export const ICP_LOCATIONS_MAX = 4;
export const ICP_COMPANY_TYPES_MAX = 4;
export const ICP_COMPANY_SIZES_MAX = 4;
export const ICP_EXCLUDE_PROFILES_MAX = 4;
export const ICP_EXCLUDE_KEYWORDS_MAX = 6;

/** One chip's worth of text. Longer than this stops being a chip. */
const ICP_ENTRY_MAX_LENGTH = 120;

/**
 * What one generation produces.
 *
 * `painPoints` rides along because it comes from the same reading of the
 * company profile and dot 3 asks the user to confirm it (reference 05); the
 * seven lists are exactly `agents.icp`.
 */
export const vIcpGeneration = v.object({
  jobTitles: v.array(v.string()),
  industries: v.array(v.string()),
  locations: v.array(v.string()),
  companyTypes: v.array(v.string()),
  companySizes: v.array(v.string()),
  excludeProfiles: v.array(v.string()),
  excludeKeywords: v.array(v.string()),
  painPoints: v.string(),
});

export type IcpGeneration = Infer<typeof vIcpGeneration>;

/** The company profile one generation reads, and the vocabularies it must
 *  pick from. Plain data: the domain assembles it. */
export type IcpGenerationInput = {
  profile: {
    companyName: string;
    industry: string;
    description: string;
    keyFeatures: readonly string[];
    socialProof: readonly string[];
  };
  allowed: {
    industries: readonly string[];
    locations: readonly string[];
    companyTypes: readonly string[];
    /** Our own headcount bands, by their labels. */
    companySizes: readonly string[];
    /** Our own profile exclusions, by their labels. */
    excludeProfiles: readonly string[];
  };
};

/** Words too common to tell one industry from another. */
const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "our",
  "your",
  "that",
  "this",
  "from",
  "are",
  "you",
  "all",
  "who",
  "how",
  "into",
  "other",
  "services",
  "service",
  "solutions",
  "software",
  "platform",
  "company",
  "companies",
  "business",
  "businesses",
]);

function significantWords(text: string): Set<string> {
  const words = text.toLocaleLowerCase().match(/[a-z]{3,}/g) ?? [];
  return new Set(words.filter((word) => !STOP_WORDS.has(word)));
}

/**
 * Cut a long allowed list down to the entries worth offering.
 *
 * The industry catalogue alone has 454 values (spikes §3); sending all of them
 * with every other list would eat most of the call's character budget and push
 * the profile itself out of the prompt. So a list longer than `max` is scored
 * against the words of the company profile — an entry sharing a word with what
 * the company sells is kept first — and the remaining places are filled in the
 * catalogue's own order, so the shortlist is never only the lucky matches.
 *
 * Nothing is invented: every entry returned is still a catalogue value, and a
 * value that did not make the shortlist is simply not offered to the model.
 * The user can still add it by hand, because the picker on reference 07 reads
 * the whole catalogue.
 */
export function shortlistAllowedValues(
  values: readonly string[],
  profileText: string,
  max: number,
): string[] {
  if (values.length <= max) {
    return [...values];
  }
  const words = significantWords(profileText);
  const matched: string[] = [];
  const rest: string[] = [];
  for (const value of values) {
    const hit = [...significantWords(value)].some((word) => words.has(word));
    (hit ? matched : rest).push(value);
  }
  return [...matched, ...rest].slice(0, max);
}

export const ICP_GENERATION_SYSTEM = [
  "You read a company's own profile and describe the people worth selling it",
  "to: their job titles, the companies they work at, and who to leave out.",
  "",
  "Five of the lists are CLOSED. For industries, locations, companyTypes,",
  "companySizes and excludeProfiles you may only return values that appear,",
  "character for character, in the allowed lists given to you — same spelling,",
  "same capitalisation, same punctuation. A value that is not on the list is",
  "worse than no value: it matches nobody and the user never finds out why.",
  "Return an empty list rather than a value you had to invent or adjust.",
  "",
  "Rules:",
  `- jobTitles: ${ICP_JOB_TITLES_MIN} to ${ICP_JOB_TITLES_MAX} titles the buyer`,
  "  actually holds, as they would write them on a profile (e.g. \"Head of",
  "  Growth\"). Free text. Prefer the person who OWNS the problem this company",
  "  solves over the person who signs the cheque, and do not pad the list with",
  "  near-duplicates — similar titles are matched automatically.",
  `- industries: up to ${ICP_INDUSTRIES_MAX} values from the allowed list —`,
  "  the industries the CUSTOMER is in, not the one this company is in. Leave",
  "  it empty when the product genuinely sells across all of them.",
  `- locations: up to ${ICP_LOCATIONS_MAX} values from the allowed list. Prefer`,
  "  a broad region over a country unless the profile clearly sells to one",
  "  country. Empty means worldwide.",
  `- companyTypes: up to ${ICP_COMPANY_TYPES_MAX} values from the allowed list.`,
  "  Empty means any kind of organisation.",
  `- companySizes: up to ${ICP_COMPANY_SIZES_MAX} values from the allowed list,`,
  "  as a contiguous run of bands. Empty means any size.",
  `- excludeProfiles: up to ${ICP_EXCLUDE_PROFILES_MAX} values from the allowed`,
  "  list — the kinds of person who look like a match but never buy. Pick only",
  "  the ones the profile gives a real reason for.",
  `- excludeKeywords: up to ${ICP_EXCLUDE_KEYWORDS_MAX} named competitors or`,
  "  words that mark a bad fit, one short phrase each. Free text. Name only",
  "  competitors you can infer from the profile; do not guess at random brands.",
  "- painPoints: the two or three problems this company's customers have, in",
  `  the customer's own plain words, at most ${COMPANY_PAIN_POINTS_MAX_LENGTH}`,
  "  characters. No marketing language.",
  "- Write in the language of the company profile, except for the closed",
  "  lists, which are copied exactly as given.",
].join("\n");

/** The user half of the call: the profile and the vocabularies, and nothing
 *  about how to answer. */
export function icpGenerationInput(input: IcpGenerationInput): string {
  const { profile, allowed } = input;
  const list = (entries: readonly string[]): string =>
    entries.length === 0 ? "(none available)" : entries.join("\n");
  return [
    "COMPANY PROFILE",
    `Name: ${profile.companyName}`,
    `Sells in: ${profile.industry}`,
    `What it does: ${profile.description}`,
    "What it offers:",
    list(profile.keyFeatures),
    "Proof it states:",
    list(profile.socialProof),
    "",
    "ALLOWED INDUSTRIES (copy exactly, one per line)",
    list(allowed.industries),
    "",
    "ALLOWED LOCATIONS (copy exactly, one per line)",
    list(allowed.locations),
    "",
    "ALLOWED COMPANY TYPES (copy exactly, one per line)",
    list(allowed.companyTypes),
    "",
    "ALLOWED COMPANY SIZES (copy exactly, one per line)",
    list(allowed.companySizes),
    "",
    "ALLOWED PROFILE EXCLUSIONS (copy exactly, one per line)",
    list(allowed.excludeProfiles),
  ].join("\n");
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/** Trim, drop the blanks, drop the case-insensitive duplicates, take the
 *  first `maxItems`. Order is the model's. */
function boundedEntries(
  entries: readonly string[],
  maxItems: number,
): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const entry of entries) {
    const value = clamp(entry, ICP_ENTRY_MAX_LENGTH);
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

/**
 * Cut a valid-but-oversized answer down to what the agent accepts.
 *
 * The model is schema-constrained on SHAPE, not on length or list size —
 * nothing in JSON Schema strict mode bounds either — so a paid generation must
 * not be thrown away because the model returned eleven job titles.
 *
 * This bounds; it does not VALIDATE the closed lists. Checking industries,
 * locations and company types against the cached catalogue needs the cache,
 * which belongs to the domain (`agents/icpModel.ts`).
 */
export function boundIcpGeneration(generated: IcpGeneration): IcpGeneration {
  return {
    jobTitles: boundedEntries(generated.jobTitles, ICP_JOB_TITLES_MAX),
    industries: boundedEntries(generated.industries, ICP_INDUSTRIES_MAX),
    locations: boundedEntries(generated.locations, ICP_LOCATIONS_MAX),
    companyTypes: boundedEntries(generated.companyTypes, ICP_COMPANY_TYPES_MAX),
    companySizes: boundedEntries(generated.companySizes, ICP_COMPANY_SIZES_MAX),
    excludeProfiles: boundedEntries(
      generated.excludeProfiles,
      ICP_EXCLUDE_PROFILES_MAX,
    ),
    excludeKeywords: boundedEntries(
      generated.excludeKeywords,
      ICP_EXCLUDE_KEYWORDS_MAX,
    ),
    painPoints: clamp(generated.painPoints, COMPANY_PAIN_POINTS_MAX_LENGTH),
  };
}
