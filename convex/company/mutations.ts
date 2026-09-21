/**
 * Business profile edits (PLAN §7).
 *
 * Writes are guarded by the active organization and use `expectedVersion`
 * optimistic concurrency. Meaningful edits increment `version`.
 *
 * `analysisStatus` is owned by the analysis flow, not by this editor: a user
 * correcting their industry must not overwrite "analyzing" with "idle". T20
 * moves it through analyzing → ready|failed and sets `firstRunUsed` on
 * success only, so a blocked site costs the user nothing (PLAN §5).
 */
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { requireOrgMember } from "../lib/auth";
import { requireRateLimit } from "../lib/rateLimits";
import { checkPublicHttpUrl } from "../lib/urlSafety";
import {
  boundedString,
  boundedStringList,
  COMPANY_DESCRIPTION_MAX_LENGTH,
  COMPANY_LIST_ITEM_MAX_LENGTH,
  COMPANY_LIST_MAX_ITEMS,
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_PAIN_POINTS_MAX_LENGTH,
  domainError,
  invalid,
} from "../lib/validators";
import {
  ANALYSIS_STALE_AFTER_MS,
  analysisOperationKeys,
  getOrgProfile,
} from "./model";
import { vBusinessProfileDoc } from "./queries";
import { v } from "convex/values";

/**
 * Admit a typed-in website address under the fetch policy, or refuse it.
 *
 * ONE door into `businessProfiles.websiteUrl`, used by both mutations below,
 * so the address that is STORED is always one we are allowed to fetch —
 * `startAnalysis` checking it on its way to the scraper is not enough, since
 * any later reader of the stored column would inherit the SSRF vector
 * `normalizeHttpUrl` leaves open (it accepts `http://127.0.0.1/` and
 * `http://internal:8080/`).
 *
 * Every rejection reason maps to one sentence: the distinction between "that
 * is a private host" and "that is not a domain" is for operators, and telling
 * a stranger which is which turns the form into a network probe.
 */
function admitWebsiteUrl(raw: string): string {
  const admitted = checkPublicHttpUrl(raw);
  if (!admitted.ok) {
    throw invalid("websiteUrl must be a public http(s) website address");
  }
  return admitted.url.url;
}

/**
 * Create-or-update the profile. Pass `expectedVersion: 0` when no profile may
 * exist yet, or the current `version` to update. A stale version returns
 * `CONFLICT` with the authoritative record untouched.
 *
 * `websiteUrl` is optional because "I don't have a website" is a supported
 * path (PLAN §5): the user types the name and description instead and
 * everything downstream runs from those.
 */
export const update = mutation({
  args: {
    orgId: v.id("orgs"),
    expectedVersion: v.number(),
    websiteUrl: v.optional(v.string()),
    companyName: v.string(),
    industry: v.string(),
    description: v.string(),
    keyFeatures: v.array(v.string()),
    socialProof: v.array(v.string()),
    painPoints: v.string(),
  },
  returns: vBusinessProfileDoc,
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.orgId);

    // The SAME policy the fetch uses, at the point of STORAGE. An ABSENT
    // address is not a rejected one: "I don't have a website" is a supported
    // path (PLAN §5), and the user types the name and description instead.
    const websiteUrl =
      args.websiteUrl === undefined
        ? undefined
        : admitWebsiteUrl(args.websiteUrl);
    const companyName = boundedString(args.companyName, "companyName", {
      min: 1,
      max: COMPANY_NAME_MAX_LENGTH,
    });
    const industry = boundedString(args.industry, "industry", {
      max: COMPANY_LIST_ITEM_MAX_LENGTH,
    });
    const description = boundedString(args.description, "description", {
      max: COMPANY_DESCRIPTION_MAX_LENGTH,
    });
    const keyFeatures = boundedStringList(args.keyFeatures, "keyFeatures", {
      maxItems: COMPANY_LIST_MAX_ITEMS,
      itemMax: COMPANY_LIST_ITEM_MAX_LENGTH,
    });
    const socialProof = boundedStringList(args.socialProof, "socialProof", {
      maxItems: COMPANY_LIST_MAX_ITEMS,
      itemMax: COMPANY_LIST_ITEM_MAX_LENGTH,
    });
    const painPoints = boundedString(args.painPoints, "painPoints", {
      max: COMPANY_PAIN_POINTS_MAX_LENGTH,
    });

    const existing = await getOrgProfile(ctx, args.orgId);

    const now = Date.now();
    if (existing === null) {
      if (args.expectedVersion !== 0) {
        throw domainError(
          "CONFLICT",
          "no business profile exists; expectedVersion must be 0",
        );
      }
      const id = await ctx.db.insert("businessProfiles", {
        orgId: args.orgId,
        ...(websiteUrl !== undefined ? { websiteUrl } : {}),
        companyName,
        industry,
        description,
        keyFeatures,
        socialProof,
        painPoints,
        // Typed by hand, so there is nothing for an analysis to report yet.
        analysisStatus: { state: "idle" },
        firstRunUsed: false,
        version: 1,
        updatedAt: now,
      });
      const created = await ctx.db.get("businessProfiles", id);
      if (created === null) {
        throw domainError("NOT_FOUND", "business profile not found");
      }
      return created;
    }

    if (existing.version !== args.expectedVersion) {
      throw domainError(
        "CONFLICT",
        `business profile version is ${existing.version}, not ${args.expectedVersion}`,
      );
    }

    const sameList = (stored: readonly string[], next: readonly string[]) =>
      stored.length === next.length &&
      stored.every((value, index) => value === next[index]);
    const changed =
      existing.websiteUrl !== websiteUrl ||
      existing.companyName !== companyName ||
      existing.industry !== industry ||
      existing.description !== description ||
      existing.painPoints !== painPoints ||
      !sameList(existing.keyFeatures, keyFeatures) ||
      !sameList(existing.socialProof, socialProof);

    await ctx.db.patch("businessProfiles", existing._id, {
      websiteUrl,
      companyName,
      industry,
      description,
      keyFeatures,
      socialProof,
      painPoints,
      version: changed ? existing.version + 1 : existing.version,
      updatedAt: now,
    });
    const updated = await ctx.db.get("businessProfiles", existing._id);
    if (updated === null) {
      throw domainError("NOT_FOUND", "business profile not found");
    }
    return updated;
  },
});

/**
 * Start a website analysis: onboarding step 1's Analyze, Retry and
 * Regenerate all arrive here (PLAN §3 step 1, §5).
 *
 * The mutation is the only authenticated part of the flow. It checks
 * organization, admits the URL under the SAME policy the fetch will use,
 * spends one rate-limit token, records `analyzing` so the form can show live
 * status from its own reactive query, and schedules the internal action that
 * is allowed to spend money. No provider is contacted from here, and the URL
 * the action is given is the NORMALISED one this mutation stored — never the
 * raw string the browser sent (EXECUTION §0.5).
 *
 * Which of the three buttons pressed it is derived from the stored state
 * rather than trusted from the client: a run that starts while the profile is
 * already `ready` for this same URL is a Regenerate, and only it gets a fresh
 * operation key, so only it buys the pages again. See `model.ts`.
 */
export const startAnalysis = mutation({
  args: {
    orgId: v.id("orgs"),
    websiteUrl: v.string(),
  },
  returns: v.object({ startedAt: v.number() }),
  handler: async (ctx, args) => {
    const { identityKey } = await requireOrgMember(ctx, args.orgId);

    // The same admission `update` stores through, so the two doors into
    // `businessProfiles.websiteUrl` cannot drift apart. First of all, so a
    // blank or unusable address costs no rate-limit token, stores nothing and
    // schedules nothing — no website means no scrape.
    const websiteUrl = admitWebsiteUrl(args.websiteUrl);

    // Before the reserve, so a refused caller leaves nothing behind.
    await requireRateLimit(ctx, "analyzeWebsite", identityKey);

    const existing = await getOrgProfile(ctx, args.orgId);
    const now = Date.now();
    if (
      existing !== null &&
      existing.analysisStatus.state === "analyzing" &&
      now - existing.analysisStatus.startedAt < ANALYSIS_STALE_AFTER_MS
    ) {
      throw domainError(
        "CONFLICT",
        "an analysis of this organization's website is already running",
      );
    }

    const fresh =
      existing !== null &&
      existing.analysisStatus.state === "ready" &&
      existing.websiteUrl === websiteUrl;
    const keys = await analysisOperationKeys({
      orgId: args.orgId,
      websiteUrl,
      startedAt: now,
      fresh,
    });

    const analysisStatus = { state: "analyzing", startedAt: now } as const;
    let profileId;
    if (existing === null) {
      profileId = await ctx.db.insert("businessProfiles", {
        orgId: args.orgId,
        websiteUrl,
        // Empty until the analysis answers. The form shows its own analyzing
        // state meanwhile, never blank fields presented as a result.
        companyName: "",
        industry: "",
        description: "",
        keyFeatures: [],
        socialProof: [],
        painPoints: "",
        analysisStatus,
        firstRunUsed: false,
        version: 1,
        updatedAt: now,
      });
    } else {
      profileId = existing._id;
      await ctx.db.patch("businessProfiles", profileId, {
        websiteUrl,
        analysisStatus,
        updatedAt: now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.company.actions.analyze, {
      orgId: args.orgId,
      profileId,
      websiteUrl,
      startedAt: now,
      scrapeOperationKey: keys.scrape,
      aiOperationKey: keys.ai,
    });

    return { startedAt: now };
  },
});
