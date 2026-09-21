/**
 * The posted credit prices and the trial limits a screen shows — the one
 * part of the PLAN §6 policy the BROWSER imports.
 *
 * It exists because a constant a client file imports ships to the browser
 * as plain JavaScript, whole module included. The prices used to sit in
 * `limits.ts` beside each action's provider, so importing them to print
 * "3 credits" put the lead-data and web-research providers' names in the
 * bundle (PLAN §4 "White-label rule"). The server reads these same objects
 * through `limits.ts`, so the price a screen posts and the price a call
 * charges cannot drift apart.
 *
 * NEVER ADD, not even as a type, a field or a comment: a provider name, an
 * environment variable name, a hidden per-org cap, a platform budget, or an
 * import of a module that holds one. Everything here is public. Server-only
 * policy belongs in `limits.ts`, which may import this file — never the
 * reverse.
 */

/**
 * Everything that costs us money, named by what the USER did — not by who
 * answered it. The union is the key of the price table below, so a new paid
 * step cannot be added without pricing it.
 */
export const PAID_ACTIONS = [
  "analyze_website",
  "generate_icp",
  "recommend_signals",
  "generate_keywords",
  "find_leads",
  "research_lead",
  "get_email",
  "write_email",
  "handle_reply",
  // The AI half of a two-provider action. Zero credits by design: the user
  // pays once, on the step that fetched the page (`analyze_website`,
  // `research_lead`), and a failed AI half is retried from the stored markdown
  // without buying the page again (PLAN §6 "billed … even if a later step
  // failed"). Still a paid call, so it is metered and capped in `ai_calls`.
  "profile_company",
  "score_lead",
] as const;

export type PaidAction = (typeof PAID_ACTIONS)[number];

export type PostedPrice = {
  /** Credits the action costs once it is no longer free. */
  credits: number;
  /**
   * The first successful run of this action in an org is free (PLAN §6:
   * "First-run onboarding … 0 (once each)"). Every later run costs `credits`,
   * which is what the reference's "Re-run" and "Generate more" buttons spend.
   */
  firstRunFree: boolean;
};

/** PLAN §6 layer-1 table. Browsing, counting, approving and sending are free
 *  and therefore absent — a free step never calls the credit wrapper. */
export const ACTION_PRICES: Record<PaidAction, PostedPrice> = {
  analyze_website: { credits: 3, firstRunFree: true },
  generate_icp: { credits: 3, firstRunFree: true },
  recommend_signals: { credits: 3, firstRunFree: true },
  generate_keywords: { credits: 3, firstRunFree: false },
  find_leads: { credits: 2, firstRunFree: false },
  research_lead: { credits: 3, firstRunFree: false },
  get_email: { credits: 15, firstRunFree: false },
  write_email: { credits: 1, firstRunFree: false },
  handle_reply: { credits: 1, firstRunFree: false },
  profile_company: { credits: 0, firstRunFree: false },
  score_lead: { credits: 0, firstRunFree: false },
};

/** PLAN §6: the trial's daily send ceiling, whatever the owner types. */
export const TRIAL_DAILY_SEND_LIMIT_MAX = 30;
