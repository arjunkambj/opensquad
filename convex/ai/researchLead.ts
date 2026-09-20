/**
 * Research one lead: what the model is told, and what it may answer
 * (PLAN §8 `researchLead.ts`, §9.2 step 3).
 *
 * The prompt and the result validator live here and nothing else does — the
 * money, the page fetch and the writes belong to `leads/research.ts`. The
 * model sees three things: the person as the free preview described them, the
 * company profile we are selling FOR, and the company's home page when we
 * were able to read one. It answers with a 1–3 fit score, the reason for it,
 * a short research summary and up to three personalisation hooks.
 *
 * Two rules the prompt enforces and the parser then re-enforces:
 *   The model never invents a fact. A hook must be something the page or the
 *   preview actually states, because hooks become `evidence` rows cited back
 *   to the page we paid to read.
 *   Every string is bounded here, not at the storage edge. The result
 *   validator cannot express a length, so the answer is cut to the bounds the
 *   lead vocabulary states before anything reaches a write.
 */
import {
  EVIDENCE_OBSERVATION_MAX_LENGTH,
  LEAD_SCORE_REASON_MAX_LENGTH,
  LEAD_SUMMARY_MAX_LENGTH,
} from "../lib/validators";
import { v } from "convex/values";
import type { Infer } from "convex/values";

/**
 * The answer. `aiScore` is the 1–3 flame score the Contacts table shows, so
 * it is a union of literals — the gateway is given an enum and cannot return
 * a 7 (spikes §2).
 */
export const vResearchLeadResult = v.object({
  aiScore: v.union(v.literal(1), v.literal(2), v.literal(3)),
  aiScoreReason: v.string(),
  summary: v.string(),
  hooks: v.array(v.string()),
});

export type ResearchLeadResult = Infer<typeof vResearchLeadResult>;

/* Output bounds. Each sits well inside the maximum its storage field allows,
 * because the point is a summary a person reads in the lead drawer, not the
 * longest string the column accepts. */
const SUMMARY_MAX = 1_200;

const SCORE_REASON_MAX = 400;

const HOOK_MAX = 240;

export const RESEARCH_HOOKS_MAX = 3;

/** Characters of the company's page one research call may carry. The profile
 *  and the preview are small and go first, so a long page is what gets cut. */
const PAGE_MARKDOWN_BUDGET = 12_000;

/** Output tokens: four small fields, with room for a full summary. */
export const RESEARCH_MAX_OUTPUT_TOKENS = 1_024;

export const RESEARCH_LEAD_SYSTEM = [
  "You qualify sales leads for a B2B company.",
  "You are given the company you are selling FOR, one person who might be a",
  "buyer, and — when it could be read — that person's company home page.",
  "",
  "Score the fit from 1 to 3:",
  "3 — a strong fit: the person's role decides or strongly influences a",
  "purchase like this, and their company matches what the seller serves.",
  "2 — a plausible fit: the role or the company fits, the other is unclear.",
  "1 — a weak fit: the role or the company argues against it.",
  "",
  "Rules:",
  "- Use ONLY the facts given. Never invent a name, a number, a customer or a",
  "  product. If the page is missing or says little, score from the person's",
  "  role alone and say that is what you did.",
  "- `summary` is what a salesperson needs to know before writing to this",
  "  person: what the company does, who it serves, and anything that makes",
  "  the timing relevant.",
  "- `aiScoreReason` is one sentence for the score.",
  "- `hooks` are at most three concrete openers, each grounded in a stated",
  "  fact. No flattery, no questions, no invented detail. Return an empty",
  "  list rather than a hook you cannot support.",
  "- Write plainly, in the third person, with no greeting and no sign-off.",
].join("\n");

export type ResearchLeadInput = {
  seller: {
    companyName: string;
    industry: string;
    description: string;
    keyFeatures: string[];
    painPoints: string;
  };
  lead: {
    jobTitle?: string;
    jobLevel?: string;
    headline?: string;
    companyName?: string;
    canonicalDomain?: string;
    location?: string;
    companyIndustry?: string;
    employeeCount?: number;
  };
  /** The company's home page as markdown, absent when none could be read. */
  pageMarkdown?: string;
  /** How many of the agent's signals matched this person (PLAN §3). */
  signalCount: number;
};

/**
 * The prompt body. Sections are labelled rather than interpolated into prose
 * so a value that happens to read like an instruction cannot become one, and
 * the page goes LAST so truncation eats the page and never the task.
 */
export function researchLeadInput(input: ResearchLeadInput): string {
  const lines: string[] = [
    "## The company we sell for",
    `Name: ${input.seller.companyName}`,
    `Industry: ${input.seller.industry}`,
    `What it does: ${input.seller.description}`,
  ];
  if (input.seller.keyFeatures.length > 0) {
    lines.push(`What it offers: ${input.seller.keyFeatures.join("; ")}`);
  }
  if (input.seller.painPoints.trim() !== "") {
    lines.push(`Problems it solves: ${input.seller.painPoints}`);
  }

  lines.push("", "## The person");
  const person: Array<[string, string]> = [];
  if (input.lead.jobTitle !== undefined) {
    person.push(["Job title", input.lead.jobTitle]);
  }
  if (input.lead.jobLevel !== undefined) {
    person.push(["Seniority", input.lead.jobLevel]);
  }
  if (input.lead.headline !== undefined) {
    person.push(["Profile headline", input.lead.headline]);
  }
  if (input.lead.location !== undefined) {
    person.push(["Location", input.lead.location]);
  }
  if (input.lead.companyName !== undefined) {
    person.push(["Company", input.lead.companyName]);
  }
  if (input.lead.canonicalDomain !== undefined) {
    person.push(["Company site", input.lead.canonicalDomain]);
  }
  if (input.lead.companyIndustry !== undefined) {
    person.push(["Company industry", input.lead.companyIndustry]);
  }
  if (input.lead.employeeCount !== undefined) {
    person.push(["Company headcount", String(input.lead.employeeCount)]);
  }
  lines.push(
    ...(person.length > 0
      ? person.map(([label, value]) => `${label}: ${value}`)
      : ["Nothing beyond the fact that they were matched by a saved search."]),
  );
  lines.push(
    `Saved searches that matched this person: ${Math.max(1, input.signalCount)}`,
  );

  lines.push("", "## Their company's home page");
  lines.push(
    input.pageMarkdown === undefined || input.pageMarkdown.trim() === ""
      ? "Not available — score from the person's role and company facts alone."
      : input.pageMarkdown.slice(0, PAGE_MARKDOWN_BUDGET),
  );
  return lines.join("\n");
}

/**
 * Cut a validated answer down to what the lead record stores. The gateway
 * honours the schema's shape but not a length, so this is where "bounded" is
 * actually true — and it is why nothing writes `result.summary` directly.
 */
export function boundResearchResult(
  result: ResearchLeadResult,
): ResearchLeadResult {
  const hooks: string[] = [];
  for (const hook of result.hooks) {
    const trimmed = hook.trim();
    if (trimmed === "") {
      continue;
    }
    hooks.push(trimmed.slice(0, Math.min(HOOK_MAX, EVIDENCE_OBSERVATION_MAX_LENGTH)));
    if (hooks.length >= RESEARCH_HOOKS_MAX) {
      break;
    }
  }
  return {
    aiScore: result.aiScore,
    aiScoreReason: result.aiScoreReason
      .trim()
      .slice(0, Math.min(SCORE_REASON_MAX, LEAD_SCORE_REASON_MAX_LENGTH)),
    summary: result.summary
      .trim()
      .slice(0, Math.min(SUMMARY_MAX, LEAD_SUMMARY_MAX_LENGTH)),
    hooks,
  };
}
