/**
 * Website analysis — the AI half of onboarding step 1 (PLAN §3 step 1,
 * flow.html "Enter your website, press Analyze").
 *
 * This file holds ONE task's prompt and the shape of its answer, and nothing
 * else: no `ctx`, no database, no domain import, no provider call. The company
 * domain brings the scraped markdown and persists what comes back
 * (`convex/company/actions.ts`), which is what keeps the prompt reviewable on
 * its own and this module importable by the industry `<select>` on the client.
 *
 * The result validator is the single source of truth: `ai/run.ts` derives the
 * strict JSON schema the gateway is given from it AND re-validates the answer
 * against it, so a model that drifts produces `invalid_response` rather than a
 * half-typed profile.
 */
import {
  COMPANY_DESCRIPTION_MAX_LENGTH,
  COMPANY_LIST_ITEM_MAX_LENGTH,
  COMPANY_NAME_MAX_LENGTH,
} from "../lib/validators";
import { PLAIN_VOICE_RULES } from "./voice";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * The industries a profile may carry. A closed list, not free text, because
 * three things downstream read it: the ICP generator (T21), the strategy
 * recommender (T23) and the `<select>` on the company form. An open string
 * would make all three guess.
 *
 * Declared as a union first and turned into a list below, so the validator the
 * model is constrained by and the options the user picks from cannot drift.
 */
export const vCompanyIndustry = v.union(
  v.literal("Software & SaaS"),
  v.literal("IT Services & Consulting"),
  v.literal("Marketing & Advertising"),
  v.literal("E-commerce & Retail"),
  v.literal("Financial Services"),
  v.literal("Insurance"),
  v.literal("Healthcare & Life Sciences"),
  v.literal("Education & Training"),
  v.literal("Real Estate & Construction"),
  v.literal("Manufacturing & Industrial"),
  v.literal("Logistics & Transportation"),
  v.literal("Media & Entertainment"),
  v.literal("Travel & Hospitality"),
  v.literal("Energy & Utilities"),
  v.literal("Legal & Professional Services"),
  v.literal("Recruiting & HR"),
  v.literal("Nonprofit & Government"),
  v.literal("Other"),
);

export type CompanyIndustry = Infer<typeof vCompanyIndustry>;

/** The same values as an ordered list, for the form's options. */
export const COMPANY_INDUSTRIES: readonly CompanyIndustry[] =
  vCompanyIndustry.members.map((member) => member.value);

/** Practical bounds the prompt asks for. The hard ceilings in
 *  `lib/validators/company.ts` are what the write is clamped to; these are
 *  what makes the answer readable in a form field. */
export const WEBSITE_ANALYSIS_DESCRIPTION_MAX = 600;
export const WEBSITE_ANALYSIS_FEATURE_MAX = 140;
export const WEBSITE_ANALYSIS_FEATURES_MIN = 3;
export const WEBSITE_ANALYSIS_FEATURES_MAX = 6;
export const WEBSITE_ANALYSIS_PROOFS_MAX = 5;

/**
 * What one analysis produces. It is deliberately the subset of
 * `businessProfiles` a website can honestly answer: pain points are the user's
 * own words and are asked for in onboarding dot 3, never inferred here.
 */
export const vWebsiteAnalysis = v.object({
  companyName: v.string(),
  industry: vCompanyIndustry,
  description: v.string(),
  keyFeatures: v.array(v.string()),
  socialProof: v.array(v.string()),
});

export type WebsiteAnalysis = Infer<typeof vWebsiteAnalysis>;

export const WEBSITE_ANALYSIS_SYSTEM = [
  "You read a company's own website and write the profile a salesperson would",
  "keep on their desk before calling that company's prospects.",
  "",
  "Rules:",
  "- Use ONLY what the pages say. Never invent a customer, a number, an award",
  "  or a capability that is not written there.",
  "- companyName: the company's own name as it writes it, without a tagline,",
  `  legal suffix or slogan. At most ${COMPANY_NAME_MAX_LENGTH} characters.`,
  "- industry: exactly one value from the allowed list. Choose the one the",
  '  company SELLS in. Use "Other" only when none of the others fits.',
  "- description: what the company does and why a buyer would choose it, in",
  `  two or three plain sentences, at most ${WEBSITE_ANALYSIS_DESCRIPTION_MAX}`,
  "  characters. Write it as the company would explain itself to a friend,",
  "  not as its homepage headline and not as a review of the site. Say who",
  "  it's for and what it actually does; drop the adjectives.",
  `- keyFeatures: ${WEBSITE_ANALYSIS_FEATURES_MIN} to ${WEBSITE_ANALYSIS_FEATURES_MAX}`,
  "  concrete capabilities a buyer cares about, one short phrase each, at most",
  `  ${WEBSITE_ANALYSIS_FEATURE_MAX} characters. No marketing adjectives on`,
  "  their own; each line must say something the product actually does, in",
  "  plain words (\"Sends invoices from Stripe data\", not \"Seamless billing",
  "  automation\").",
  `- socialProof: up to ${WEBSITE_ANALYSIS_PROOFS_MAX} named customers, results,`,
  "  metrics or credentials stated on the site, one short phrase each. Return",
  "  an empty list when the site states none — an invented proof is worse than",
  "  no proof.",
  "- Write in the language of the website.",
  "",
  ...PLAIN_VOICE_RULES,
].join("\n");

/** The user half of the call: the pages, and nothing about how to answer. */
export function websiteAnalysisInput(combinedMarkdown: string): string {
  return [
    "Here is the company's website, as markdown. Each page starts with its URL.",
    "",
    combinedMarkdown,
  ].join("\n");
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/**
 * Cut a valid-but-oversized answer down to what the profile accepts.
 *
 * The model is asked for short lines and is schema-constrained on SHAPE, not
 * on length — nothing in JSON Schema strict mode bounds a string. A paid
 * analysis must not be thrown away because one feature line ran long, so the
 * answer is clamped here instead of being refused by the write.
 */
export function boundWebsiteAnalysis(analysis: WebsiteAnalysis): WebsiteAnalysis {
  const boundedList = (entries: readonly string[], maxItems: number): string[] =>
    entries
      .map((entry) => clamp(entry, COMPANY_LIST_ITEM_MAX_LENGTH))
      .filter((entry) => entry.length > 0)
      .slice(0, maxItems);
  return {
    companyName: clamp(analysis.companyName, COMPANY_NAME_MAX_LENGTH),
    industry: analysis.industry,
    description: clamp(analysis.description, COMPANY_DESCRIPTION_MAX_LENGTH),
    keyFeatures: boundedList(analysis.keyFeatures, WEBSITE_ANALYSIS_FEATURES_MAX),
    socialProof: boundedList(analysis.socialProof, WEBSITE_ANALYSIS_PROOFS_MAX),
  };
}
