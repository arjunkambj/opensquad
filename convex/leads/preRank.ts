/**
 * The free pre-rank (PLAN §9.2 step 2).
 *
 * Sourcing finds far more people than the trial can afford to research, so
 * the order in which they are researched is decided HERE, in plain code, at
 * zero cost: title and seniority against the ICP, company size inside the
 * range the strategy asked for, how many signals found the same person, and
 * whether there is a domain to research at all.
 *
 * It is a ranking, not a verdict: nothing is discarded for a low score, and
 * the number never reaches the user as a score (the 1–3 flame score is the
 * researched `aiScore`). `preRank` exists so the expensive step spends its
 * budget on the best rows first.
 *
 * Every input is a fact the free preview row already carried, so computing it
 * costs no call and no credit.
 */
import type { AgentIcp, LeadFilters } from "../lib/validators";

/** The facts the pre-rank reads. A superset of them lives on `prospects`. */
export type PreRankLead = {
  jobTitle?: string;
  jobLevel?: string;
  canonicalDomain?: string;
  employeeCount?: number;
};

/** Headcount the agent is looking for; either bound may be open. */
export type CompanySizeRange = { min?: number; max?: number };

export const PRE_RANK_MIN = 0;

export const PRE_RANK_MAX = 100;

/* The weights, written out so the ranking can be retuned in one place and
 * read as a sentence: a person whose title matches, at a senior level, at a
 * company of the right size, with a site we can research, found by two
 * signals, is the best row on the page. */
const WEIGHT_TITLE_MATCH = 30;

const WEIGHT_SENIORITY_MAX = 15;

const WEIGHT_SIZE_IN_RANGE = 20;

/** Absence is not a mismatch: an unknown headcount scores between the two. */
const WEIGHT_SIZE_UNKNOWN = 5;

const WEIGHT_DOMAIN_PRESENT = 15;

/** Per signal BEYOND the first — PLAN §3's multi-signal lead. */
const WEIGHT_PER_EXTRA_SIGNAL = 10;

const WEIGHT_EXTRA_SIGNALS_MAX = 20;

/**
 * Seniority as the preview row states it (spikes §3: the provider's six
 * `jobLevel` values). Matched case-insensitively; anything unrecognised
 * scores nothing rather than guessing.
 */
const SENIORITY_WEIGHTS: Record<string, number> = {
  "c-team": WEIGHT_SENIORITY_MAX,
  vp: WEIGHT_SENIORITY_MAX,
  director: 10,
  manager: 5,
  staff: 0,
  other: 0,
};

/** Numbers inside a size label, e.g. `51-200`, `1,000+`, `<10`. */
const SIZE_NUMBER = /\d[\d,]*/g;

/**
 * The headcount range this page's leads were searched for.
 *
 * The strategy's own filters win when it states them, because that is what
 * the provider was actually asked for; the ICP's size labels are the
 * fallback, parsed for the numbers in them (`51-200`, `1000+`, `<10`). A
 * label nothing can be read out of contributes nothing — an unparsed label
 * must never narrow the range and quietly demote every lead.
 */
export function companySizeRange(
  icp: AgentIcp,
  filters: LeadFilters,
): CompanySizeRange {
  const filterMin = wholeNumber(filters["employeeCountMin"]);
  const filterMax = wholeNumber(filters["employeeCountMax"]);
  if (filterMin !== undefined || filterMax !== undefined) {
    return {
      ...(filterMin !== undefined ? { min: filterMin } : {}),
      ...(filterMax !== undefined ? { max: filterMax } : {}),
    };
  }

  let min: number | undefined;
  let max: number | undefined;
  let openEnded = false;
  for (const label of icp.companySizes) {
    const numbers = [...label.matchAll(SIZE_NUMBER)].map((match) =>
      Number(match[0].replace(/,/g, "")),
    );
    if (numbers.length === 0 || numbers.some((value) => !Number.isFinite(value))) {
      continue;
    }
    const labelMin = label.trimStart().startsWith("<") ? 0 : Math.min(...numbers);
    min = min === undefined ? labelMin : Math.min(min, labelMin);
    if (label.includes("+")) {
      openEnded = true;
      continue;
    }
    const labelMax = Math.max(...numbers);
    max = max === undefined ? labelMax : Math.max(max, labelMax);
  }
  return {
    ...(min !== undefined ? { min } : {}),
    ...(openEnded || max === undefined ? {} : { max }),
  };
}

/**
 * Rank one lead from 0 to 100. Deterministic in its inputs, so re-ranking the
 * same lead after a second signal found it can only raise the number.
 */
export function preRankLead(args: {
  lead: PreRankLead;
  icp: AgentIcp;
  sizeRange: CompanySizeRange;
  /** How many strategies have matched this person so far; at least 1. */
  signalCount: number;
}): number {
  const score =
    titleScore(args.lead.jobTitle, args.icp.jobTitles) +
    seniorityScore(args.lead.jobLevel) +
    sizeScore(args.lead.employeeCount, args.sizeRange) +
    signalScore(args.signalCount) +
    (args.lead.canonicalDomain !== undefined ? WEIGHT_DOMAIN_PRESENT : 0);
  return Math.max(PRE_RANK_MIN, Math.min(PRE_RANK_MAX, Math.round(score)));
}

/**
 * A title matches when either string contains the other: the ICP asks for
 * "Head of Marketing" and the page returns "Global Head of Marketing, EMEA",
 * which is the same person in a bigger company.
 */
function titleScore(jobTitle: string | undefined, jobTitles: string[]): number {
  if (jobTitle === undefined || jobTitles.length === 0) {
    return 0;
  }
  const actual = jobTitle.toLowerCase();
  const matched = jobTitles.some((wanted) => {
    const target = wanted.trim().toLowerCase();
    return (
      target.length > 0 && (actual.includes(target) || target.includes(actual))
    );
  });
  return matched ? WEIGHT_TITLE_MATCH : 0;
}

function seniorityScore(jobLevel: string | undefined): number {
  if (jobLevel === undefined) {
    return 0;
  }
  return SENIORITY_WEIGHTS[jobLevel.trim().toLowerCase()] ?? 0;
}

function sizeScore(
  employeeCount: number | undefined,
  range: CompanySizeRange,
): number {
  if (employeeCount === undefined) {
    return WEIGHT_SIZE_UNKNOWN;
  }
  if (range.min === undefined && range.max === undefined) {
    // Nothing was asked for, so nothing is out of range.
    return WEIGHT_SIZE_IN_RANGE;
  }
  const aboveMin = range.min === undefined || employeeCount >= range.min;
  const belowMax = range.max === undefined || employeeCount <= range.max;
  return aboveMin && belowMax ? WEIGHT_SIZE_IN_RANGE : 0;
}

function signalScore(signalCount: number): number {
  const extra = Math.max(0, Math.trunc(signalCount) - 1);
  return Math.min(WEIGHT_EXTRA_SIGNALS_MAX, extra * WEIGHT_PER_EXTRA_SIGNAL);
}

function wholeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}
