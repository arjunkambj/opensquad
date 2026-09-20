/**
 * Business profile edits (PLAN §7).
 *
 * Writes are guarded by the active organization and use `expectedVersion`
 * optimistic concurrency. Meaningful edits increment `version`; `updatedBy` always
 * records the authenticated actor.
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
  normalizeHttpUrl,
} from "../lib/validators";
import {
  ANALYSIS_STALE_AFTER_MS,
  analysisOperationKeys,
  getOrgProfile,
} from "./model";
import { vBusinessProfileDoc } from "./queries";
import { v } from "convex/values";

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
    const { identityKey } = await requireOrgMember(ctx, args.orgId);

    const websiteUrl =
      args.websiteUrl === undefined
        ? undefined
        : normalizeHttpUrl(args.websiteUrl, "websiteUrl");
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
        updatedBy: identityKey,
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
      updatedBy: identityKey,
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
 * organization, spends one rate-limit token, admits the URL under the SAME
 * policy the fetch will use, records `analyzing` so the form can show live
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
    // Before the reserve, so a refused caller leaves nothing behind.
    await requireRateLimit(ctx, "analyzeWebsite", identityKey);

    const admitted = checkPublicHttpUrl(args.websiteUrl);
    if (!admitted.ok) {
      // One sentence for every rejection reason: the distinction is for
      // operators, and the screen says "we can't read that address".
      throw invalid("websiteUrl must be a public http(s) website address");
    }
    const websiteUrl = admitted.url.url;

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
        updatedBy: identityKey,
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
      updatedBy: identityKey,
    });

    return { startedAt: now };
  },
});
