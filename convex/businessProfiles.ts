/**
 * Business profile — one current record per workspace (PLAN §7), the company
 * we are selling FOR. Website analysis (T20) fills it from the user's own
 * site; every field stays editable afterwards.
 *
 * Reads require any active member; writes require owner or operator and use
 * `expectedVersion` optimistic concurrency. Meaningful edits increment
 * `version`; `updatedBy` always records the authenticated actor.
 *
 * `analysisStatus` is owned by the analysis flow, not by this editor: a user
 * correcting their industry must not overwrite "analyzing" with "idle". T20
 * moves it through analyzing → ready|failed and sets `firstRunUsed` on
 * success only, so a blocked site costs the user nothing (PLAN §5).
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireWorkspaceEditor, requireWorkspaceMember } from "./lib/auth";
import {
  boundedString,
  boundedStringList,
  domainError,
  normalizeHttpUrl,
  COMPANY_DESCRIPTION_MAX_LENGTH,
  COMPANY_LIST_ITEM_MAX_LENGTH,
  COMPANY_LIST_MAX_ITEMS,
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_PAIN_POINTS_MAX_LENGTH,
} from "./lib/validators";
import { businessProfileFields } from "./schema";

export const vBusinessProfileDoc = v.object({
  _id: v.id("businessProfiles"),
  _creationTime: v.number(),
  ...businessProfileFields,
});

/** The workspace's current profile, or `null` before onboarding saves one. */
export const get = query({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(vBusinessProfileDoc, v.null()),
  handler: async (ctx, args) => {
    await requireWorkspaceMember(ctx, args.workspaceId);
    return await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .unique();
  },
});

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
    workspaceId: v.id("workspaces"),
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
    const { identityKey } = await requireWorkspaceEditor(ctx, args.workspaceId);

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

    const existing = await ctx.db
      .query("businessProfiles")
      .withIndex("by_workspaceId", (q) =>
        q.eq("workspaceId", args.workspaceId),
      )
      .unique();

    const now = Date.now();
    if (existing === null) {
      if (args.expectedVersion !== 0) {
        throw domainError(
          "CONFLICT",
          "no business profile exists; expectedVersion must be 0",
        );
      }
      const id = await ctx.db.insert("businessProfiles", {
        workspaceId: args.workspaceId,
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
