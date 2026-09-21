/**
 * Company — the plain typed helpers the profile's functions share.
 *
 * Two things live here that are easy to get wrong anywhere else: what makes a
 * profile complete enough to leave onboarding dot 1, and which operation key
 * an analysis run spends money under.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { computeResultDigest } from "../lib/validators";

/** The org's current profile, or `null` before one is written. */
export async function getOrgProfile(
  ctx: QueryCtx,
  orgId: Id<"orgs">,
): Promise<Doc<"businessProfiles"> | null> {
  return await ctx.db
    .query("businessProfiles")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
}

/**
 * Is there enough here for everything downstream to run?
 *
 * Name, industry and description are what the ICP generator, the strategy
 * recommender and every written email read (PLAN §3). Key features are what
 * outreach is allowed to claim, so an empty list would leave the agent with
 * nothing true to say. Social proof is genuinely optional — a young company
 * has none, and an invented one is worse than none.
 */
export function profileIsComplete(
  profile: Doc<"businessProfiles"> | null,
): profile is Doc<"businessProfiles"> {
  return (
    profile !== null &&
    profile.companyName.trim().length > 0 &&
    profile.industry.trim().length > 0 &&
    profile.description.trim().length > 0 &&
    profile.keyFeatures.length > 0
  );
}

/** Enough of a hash to separate two websites, short enough to leave room in
 *  `OPERATION_KEY_MAX` once the action prefix is added. */
const URL_TOKEN_LENGTH = 16;

export type AnalysisOperationKeys = {
  /** The scrape. Stable per website, so Retry replays the pages we own. */
  scrape: string;
  /** The model call. Fresh every run, so Retry really re-asks the model. */
  ai: string;
};

/**
 * The two keys one run spends under.
 *
 * The scrape's key is `org:urlToken` — deliberately STABLE. A user who
 * presses Analyze twice, or Retry after the model half failed, replays pages
 * that are already bought instead of buying them again, which is what makes
 * "the free first run is only consumed on success" true in money as well as
 * in wording (PLAN §5).
 *
 * `fresh` breaks that tie, and only Regenerate sets it: the point of
 * Regenerate is to read the site AGAIN, for 3 credits, so it must not be
 * allowed to land on a key the ledger has already settled.
 *
 * The model half always gets `startedAt` in its key. A replayed AI operation
 * returns no object at all (`ai/run.ts`), so reusing that key would make every
 * retry fail identically and for free.
 */
export async function analysisOperationKeys(args: {
  orgId: Id<"orgs">;
  websiteUrl: string;
  startedAt: number;
  fresh: boolean;
}): Promise<AnalysisOperationKeys> {
  const digest = await computeResultDigest({ url: args.websiteUrl });
  const urlToken = digest.slice("sha256:".length, "sha256:".length + URL_TOKEN_LENGTH);
  const scrape = `${args.orgId}:${urlToken}${args.fresh ? `:${args.startedAt}` : ""}`;
  return { scrape, ai: `${args.orgId}:${args.startedAt}` };
}

/**
 * How long an `analyzing` status may sit before a new run may replace it.
 *
 * The internal action always reports back, so this only covers the case where
 * the deployment lost the scheduled call entirely. Without it a user whose run
 * vanished would face a permanently disabled button.
 */
export const ANALYSIS_STALE_AFTER_MS = 5 * 60_000;
